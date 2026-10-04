/**
 * TelegramBridge — `telegraf`-backed implementation of
 * `MessagingBridge` (see `./MessagingBridge.js`).
 *
 * Phase 1 / Stream 1c — the real-world integration.  Wraps a single
 * Telegraf bot instance.  Supports BOTH webhook and long-polling
 * modes (Q-H2.3 lock); the caller picks at construction time.
 *
 * Q-H2.4 lock — addressed-only filter.  Incoming messages reach the
 * registered handler ONLY when they are:
 *
 *   1. In a private DM chat with the bot      (chat.type === 'private'), OR
 *   2. Prefixed with `@<botUsername>`         (case-insensitive), OR
 *   3. A reply to a message the bot itself authored.
 *
 * Anything else — e.g. random group chatter — is silently dropped.
 * The leading `@<botUsername>` mention (if any) is stripped before
 * handing the message to the agent so skill code never sees the
 * mention prefix.
 *
 * Inline-button taps come back to Telegraf as a `callback_query`
 * update.  We synthesise a fresh `IncomingMessage` whose `text` is
 * the button's `id` (i.e. its `callback_data`) and whose `replyTo`
 * points at the original bot message.  This funnels button presses
 * through the same regex/LLM dispatch path as plain text — a
 * uniform input model.  We always call `ctx.answerCbQuery()` so the
 * Telegram client doesn't leave the user staring at a spinner.
 *
 * The `telegrafFactory` constructor option is the test seam: it
 * receives the bot token and must return a Telegraf-like instance
 * exposing `on`, `launch`, `stop`, `telegram.{sendMessage,
 * setWebhook,getMe}`, plus a writable `botInfo`.  Production code
 * defaults to the real `Telegraf` constructor.
 *
 * Graceful shutdown mirrors the pattern from
 * `apps/folio/src/cli/serveCmd.js` (Folio v2.12 / commit f40086e):
 * call `bot.stop()`, then arm a 4-second `setTimeout(...).unref()`
 * as a hard-exit safety net so a stuck socket can't hang the
 * process indefinitely.
 */

import { Telegraf } from 'telegraf';

/**
 * Convert our `Reply.buttons` shape into Telegram's `inline_keyboard`
 * (a 2D array — outer = rows, inner = buttons in that row).  We default
 * to one-button-per-row to keep long lists readable; Telegram squishes
 * many buttons onto a single line and labels truncate.  Callers can
 * override by passing a 2D array, or by setting `row` on each button.
 *
 * A button with `webApp` (a URL) opens that page inside Telegram (a Mini App) instead of sending a line back; Telegram
 * allows that only in a private chat with the bot.
 *
 * @param {Array<{label: string, id?: string, webApp?: string, row?: number}> |
 *         Array<Array<{label: string, id?: string, webApp?: string}>>} buttons
 * @returns {Array<Array<{text: string, callback_data?: string, web_app?: {url: string}}>>}
 */
export function layoutButtons(buttons) {
  const one = (b) => (typeof b?.webApp === 'string' && b.webApp ? { text: b.label, web_app: { url: b.webApp } } : { text: b.label, callback_data: b.id });
  // 2D shape: caller specified explicit rows.
  if (buttons.length > 0 && Array.isArray(buttons[0])) {
    return /** @type {any} */ (buttons).map((row) =>
      row.map(one));
  }
  // `row` field present on any button → group by row index.
  const flat = /** @type {any} */ (buttons);
  if (flat.some((b) => typeof b?.row === 'number')) {
    /** @type {Map<number, Array>} */
    const byRow = new Map();
    flat.forEach((b, idx) => {
      const r = typeof b.row === 'number' ? b.row : idx;
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r).push(one(b));
    });
    return [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r));
  }
  // Default: each button on its own row.
  return flat.map((b) => [one(b)]);
}

/**
 * Telegraf-backed `MessagingBridge`.  Moved from
 * `apps/household/src/bridges/TelegramBridge.js` into the substrate
 * 2026-05-02 (Plan B sub-task B.5) — closes Task #12.  Reusable by
 * any chat-agent consumer (H2 V2, H5, etc.).
 *
 * `telegraf` is a peer-dependency; consumers install it.
 *
 * @implements {import('../types.js').MessagingBridge}
 */
export class TelegramBridge {
  /** @type {string}  */                                                    #botToken;
  /** @type {'webhook'|'long-polling'} */                                   #mode;
  /** @type {string|undefined} */                                           #webhookUrl;
  /** @type {number} */                                                     #port;
  /** @type {string|null} */                                                #botUsername;
  /** @type {boolean} */                                                    #dropPendingUpdates;
  /** @type {{ on: Function, launch: Function, stop: Function,
              telegram: { sendMessage: Function, setWebhook: Function,
                          getMe: Function, setMyCommands?: Function, deleteMyCommands?: Function },
              botInfo?: any }} */
  #bot;
  /** @type {boolean} */                                                    #started = false;
  /** @type {NodeJS.Timeout|null} */                                        #stopTimer = null;
  /** the host hears when the long-poll stopped or stalled (`{reason}`), once */                  #onPollingDown = null;
  /** `{stallMs, everyMs, now, setInterval}` — the watchdog's clock (tests set it) */             #watchdog = null;
  /** when a getUpdates last completed (or the loop started) */                                    #lastPollAt = 0;
  /** said already: the host is told once */                                                       #downSaid = false;
  /** the watchdog's interval handle */                                                            #watchTimer = null;
  /** a stop we asked for is not a loop that died */                                               #stopping = false;
  /** @type {((msg: import('../types.js').IncomingMessage) =>
              Promise<import('../types.js').Reply>) | null} */              #handler = null;

  /**
   * @param {object} args
   * @param {string} args.botToken
   * @param {'webhook'|'long-polling'} args.mode
   * @param {string} [args.webhookUrl]
   * @param {number} [args.port]
   * @param {string} [args.botUsername]
   * @param {number} [args.handlerTimeoutMs=300000]
   *   Max time telegraf waits for our async middleware to resolve.
   *   Default 5 min — accommodates slow local LLMs (geitje / mistral
   *   7B can take 100–270s per turn on consumer hardware).
   *   Telegraf's own default is 90s, which is too tight here.
   * @param {boolean} [args.dropPendingUpdates=false]
   *   When true, Telegram drops every queued update on launch instead
   *   of delivering them.  Useful with slow local LLMs where a backlog
   *   of N messages would take N × 100s to process.  Long-polling and
   *   webhook modes both honour this.
   * @param {(token: string) => any} [args.telegrafFactory]
   * @param {string} [args.apiRoot]  a Bot API server of one's own (Telegram's self-hosted one); default api.telegram.org
   * @param {(e: {reason: 'stopped'|'stalled', error?: unknown}) => void} [args.onPollingDown]  the long-poll ended
   *   (Telegraf's loop gave up on an error it does not retry) or stalled (no poll completed for `stallMs`; a fetch
   *   without a socket timeout can hang for ever after a sleep or a network change) — said once; the host restarts
   * @param {{stallMs?: number, everyMs?: number, now?: () => number, setInterval?: Function}} [args.watchdog]
   */
  constructor({
    botToken,
    mode,
    webhookUrl,
    port = 3000,
    botUsername,
    handlerTimeoutMs,
    dropPendingUpdates = false,
    telegrafFactory,
    apiRoot,
    onPollingDown = null,
    watchdog = {},
  } = /** @type {any} */ ({})) {
    if (!botToken || typeof botToken !== 'string') {
      throw new Error('TelegramBridge: botToken (string) is required');
    }
    if (mode !== 'webhook' && mode !== 'long-polling') {
      throw new Error(
        "TelegramBridge: mode must be 'webhook' or 'long-polling'",
      );
    }
    if (mode === 'webhook' && (!webhookUrl || typeof webhookUrl !== 'string')) {
      throw new Error(
        "TelegramBridge: webhookUrl (string) is required when mode === 'webhook'",
      );
    }

    this.#botToken    = botToken;
    this.#mode        = mode;
    this.#webhookUrl  = webhookUrl;
    this.#port        = port;
    this.#botUsername = botUsername ?? null;
    this.#dropPendingUpdates = !!dropPendingUpdates;
    this.#onPollingDown = typeof onPollingDown === 'function' ? onPollingDown : null;
    // a long poll waits 50 s for news; three of them with nothing back is not a quiet chat, it is a dead socket
    this.#watchdog = { stallMs: 3 * 60 * 1000, everyMs: 30 * 1000, now: () => Date.now(), setInterval: (fn, ms) => { const h = setInterval(fn, ms); h?.unref?.(); return h; }, ...(watchdog ?? {}) };

    // handlerTimeout controls how long telegraf waits for our async
    // middleware to resolve before throwing TimeoutError.  Default is
    // 90s; we bump to 5 minutes to tolerate slow local LLMs (mistral
    // 7B has been observed at 100–270s per turn). Override via
    // `handlerTimeoutMs` constructor option.
    const handlerTimeout = handlerTimeoutMs ?? 5 * 60 * 1000;
    const factory = telegrafFactory ?? ((/** @type {string} */ token) =>
      new Telegraf(token, { handlerTimeout, ...(apiRoot ? { telegram: { apiRoot } } : {}) }));
    this.#bot = factory(botToken);

    // Wire the message + callback_query listeners eagerly — order
    // before start() so that even a synchronous test fake's `emit`
    // helper finds them registered.
    this.#bot.on('text',           (ctx) => this.#handleText(ctx));
    // A participant editing a message in the TG client sends an edited_message update
    // (payload on ctx.editedMessage, not ctx.message). Previously unhandled → silently
    // dropped; now delivered like a normal message but flagged edited.
    this.#bot.on('edited_message', (ctx) => this.#handleText(ctx));
    this.#bot.on('callback_query', (ctx) => this.#handleCallbackQuery(ctx));
  }

  // -------------------------------------------------------------------
  // MessagingBridge surface
  // -------------------------------------------------------------------

  /**
   * Begin listening.  Idempotent — calling twice is a no-op.
   *
   *   - 'long-polling': `bot.launch()` (telegraf default).
   *   - 'webhook':      `bot.launch({ webhook: { domain, port } })`,
   *                     which internally calls `setWebhook` for us.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#started) return;

    if (!this.#botUsername) {
      // Auto-detect username from the bot's own profile so the
      // @-mention filter works without the caller having to type it.
      try {
        const me = await this.#bot.telegram.getMe();
        if (me?.username) this.#botUsername = me.username;
        if (!this.#bot.botInfo) this.#bot.botInfo = me;
      } catch (_err) {
        // best-effort: a missing username just means @-mention
        // filtering will silently fail for groups; DMs + replies
        // still work.
      }
    }

    if (this.#mode === 'long-polling') {
      // Don't await — `launch()` resolves only when polling stops in
      // some telegraf versions; we want `start()` to return as soon
      // as the loop is up.  Telegraf's API matches both shapes
      // (returns a Promise that resolves on shutdown).  Tests use
      // the seam to make this synchronous-ish.
      this.#watchPolling();
      const run = this.#bot.launch(
        this.#dropPendingUpdates ? { dropPendingUpdates: true } : undefined,
      );
      // the loop ends only when it is stopped, or on an error it does not retry (a 409 conflict, a 401, a DNS error
      // that is not a FetchError): without this the bot runs on and hears nothing
      Promise.resolve(run).catch((error) => this.#pollingDown('stopped', error));
    } else {
      // webhook: telegraf's launch with a `webhook` config calls
      // setWebhook internally and starts an HTTP server on `port`.
      const url = new URL(this.#webhookUrl ?? '');
      this.#bot.launch({
        webhook: {
          domain: url.host,
          port:   this.#port,
        },
        ...(this.#dropPendingUpdates ? { dropPendingUpdates: true } : {}),
      });
    }

    this.#started = true;
  }

  /** Note every completed getUpdates, and look every `everyMs` whether one completed within `stallMs`. */
  #watchPolling() {
    const tg = this.#bot.telegram;
    const { now, stallMs, everyMs } = this.#watchdog;
    this.#lastPollAt = now();
    if (tg && typeof tg.callApi === 'function') {
      const callApi = tg.callApi.bind(tg);
      tg.callApi = (method, ...rest) => {
        const p = callApi(method, ...rest);
        if (method === 'getUpdates') Promise.resolve(p).then(() => { this.#lastPollAt = now(); }, () => { this.#lastPollAt = now(); });
        return p;
      };
    }
    this.#watchTimer = this.#watchdog.setInterval(() => {
      if (now() - this.#lastPollAt > stallMs) this.#pollingDown('stalled');
    }, everyMs);
  }

  #pollingDown(reason, error) {
    if (this.#downSaid || this.#stopping) return;
    this.#downSaid = true;
    try { this.#onPollingDown?.({ reason, ...(error !== undefined ? { error } : {}) }); } catch { /* the host's hook never throws into the bridge */ }
  }

  /**
   * Graceful shutdown.  Idempotent.
   *
   * Calls `bot.stop()` and arms a 4-second hard-exit safety net via
   * `setTimeout(..., 4000).unref()` so a stuck socket can't hang
   * the process.  The `.unref()` lets Node exit cleanly if
   * everything else closes in time — the timer never holds the
   * loop open by itself.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.#started) return;
    this.#started = false;
    this.#stopping = true;
    if (this.#watchTimer) { clearInterval(this.#watchTimer); this.#watchTimer = null; }

    try {
      this.#bot.stop('shutdown');
    } catch (_err) {
      // already stopped — fine
    }

    // Safety net — mirrors apps/folio v2.12 / commit f40086e.
    const t = setTimeout(() => {
      // istanbul ignore next — only reached if shutdown hangs
      try { process.exit(0); } catch { /* ignore */ }
    }, 4000);
    if (typeof t.unref === 'function') t.unref();
    this.#stopTimer = t;
  }

  /**
   * Send a message.  Inline buttons (if any) are stacked one per row
   * by default — Telegram cuts off button labels when too many fit
   * on one row, which makes a long list of items unreadable.
   *
   * Layout shapes accepted:
   *   - flat array `[btn, btn, btn]`   → one button per row (default)
   *   - 2D array  `[[btn], [btn,btn]]` → caller-specified rows
   *   - flat with explicit `row` field on each button → grouped by row index
   *
   * @param {import('./MessagingBridge.js').SendReplyArgs} args
   * @returns {Promise<void>}
   */
  async sendReply({ chatId, replyTo, text, buttons, noPreview = false } = /** @type {any} */ ({})) {
    /** @type {Record<string, any>} */
    const extra = {};
    // A message carrying a one-time link must not be fetched for a preview (a preview service may run the page).
    if (noPreview) extra.link_preview_options = { is_disabled: true };
    if (replyTo != null) {
      extra.reply_to_message_id = replyTo;
    }
    if (Array.isArray(buttons) && buttons.length > 0) {
      extra.reply_markup = { inline_keyboard: layoutButtons(buttons) };
    }
    await this.#bot.telegram.sendMessage(chatId, text, extra);
  }

  /**
   * The bot's command list — what Telegram's "Menu" button beside the typing box shows. Without `chatId`: every private
   * chat (for one app language when `languageCode` is named, else the default); with it: that chat alone. `clear` takes
   * a chat's own list away, so the default shows there again.
   *
   * @param {Array<{command: string, description: string}>} commands
   * @param {{chatId?: string|number, languageCode?: string, clear?: boolean}} [opts]
   * @returns {Promise<void>}
   */
  async setCommands(commands, { chatId, languageCode, clear = false } = {}) {
    /** @type {Record<string, any>} */
    const extra = { scope: chatId != null ? { type: 'chat', chat_id: chatId } : { type: 'all_private_chats' } };
    if (languageCode) extra.language_code = languageCode;
    if (clear) { await this.#bot.telegram.deleteMyCommands(extra); return; }
    await this.#bot.telegram.setMyCommands(commands, extra);
  }

  /**
   * Register the handler invoked on every (addressed) incoming
   * message.  Calling more than once REPLACES the previous handler,
   * matching the `MessagingBridge` contract.
   *
   * @param {(msg: import('../types.js').IncomingMessage) =>
   *           Promise<import('../types.js').Reply>} handler
   */
  onMessage(handler) {
    this.#handler = handler;
  }

  /**
   * MessagingBridge contract field — ChatAgent looks up the bridge
   * for a given incoming message via `bridge.id === msg.bridgeId`.
   *
   * @returns {string}
   */
  /** The bot's own @-name (known after `start()`), or null — what a `t.me/<name>` link needs. */
  get botUsername() {
    return this.#botUsername;
  }

  get id() {
    return 'telegram';
  }

  /**
   * @deprecated Use `id` instead — this getter predates the
   * MessagingBridge contract and is kept only for back-compat with
   * existing callers (notably `apps/household/test/bridges/*`).
   * Slated for removal in chat-agent v0.4.
   *
   * @returns {string}
   */
  get bridgeId() {
    return 'telegram';
  }

  // -------------------------------------------------------------------
  // Internal — incoming-update plumbing
  // -------------------------------------------------------------------

  /**
   * Handle a `text` update from telegraf.
   *
   * @param {any} ctx Telegraf-like context.
   */
  async #handleText(ctx) {
    if (!this.#handler) return;
    // A fresh message rides on ctx.message; an edit rides on ctx.editedMessage (Telegraf) /
    // ctx.update.edited_message. Resolve either and mark edits so the contribution can flag them.
    const message = ctx?.message ?? ctx?.editedMessage ?? ctx?.update?.edited_message ?? null;
    const edited  = !ctx?.message && !!message;
    if (!message || typeof message.text !== 'string') return;

    const addressed = this.#isAddressed(ctx);
    if (!addressed) return;

    const text = this.#stripMention(message.text);
    /** @type {import('../types.js').IncomingMessage} */
    const msg = {
      bridgeId:    'telegram',
      chatId:      String(ctx.chat.id),
      messageId:   String(message.message_id),
      text,
      replyTo:     message.reply_to_message
        ? String(message.reply_to_message.message_id)
        : null,
      sender:      this.#mapSender(ctx),
      isAddressed: true,
      ...(edited ? { edited: true } : {}),
    };
    const reply = await this.#handler(msg);
    await this.#postReply(msg.chatId, msg.messageId, reply);
  }

  /**
   * Handle a `callback_query` update — synthesise an
   * `IncomingMessage` whose text is the button id, then ack so the
   * client UI doesn't hang.
   *
   * @param {any} ctx Telegraf-like context.
   */
  async #handleCallbackQuery(ctx) {
    if (!this.#handler) {
      // still ack so the user's spinner clears
      try { await ctx.answerCbQuery?.(); } catch { /* ignore */ }
      return;
    }
    const cb = ctx.callbackQuery ?? ctx.update?.callback_query;
    if (!cb || typeof cb.data !== 'string') {
      try { await ctx.answerCbQuery?.(); } catch { /* ignore */ }
      return;
    }

    /** @type {import('../types.js').IncomingMessage} */
    const msg = {
      bridgeId:    'telegram',
      chatId:      String(ctx.chat?.id ?? cb.message?.chat?.id ?? ''),
      messageId:   String(cb.message?.message_id ?? ''),
      text:        cb.data,
      replyTo:     cb.message ? String(cb.message.message_id) : null,
      sender:      this.#mapSender(ctx),
      isAddressed: true,
    };

    try {
      const reply = await this.#handler(msg);
      await this.#postReply(msg.chatId, msg.messageId, reply);
    } finally {
      try { await ctx.answerCbQuery?.(); } catch { /* ignore */ }
    }
  }

  /**
   * Walk a Reply and post each message back to Telegram.  Errors on
   * individual sends are logged but don't break the loop — best-effort
   * delivery (matches Folio's pattern).
   *
   * @param {string} chatId
   * @param {string} replyTo  message-id this is replying to
   * @param {import('../types.js').Reply | null | undefined} reply
   */
  async #postReply(chatId, replyTo, reply) {
    if (!reply || !Array.isArray(reply.replies)) return;
    for (const r of reply.replies) {
      if (!r?.text) continue;
      try {
        await this.sendReply({
          chatId,
          replyTo,
          text:    r.text,
          buttons: r.buttons,
        });
      } catch (err) {
        // Don't crash the bridge on a single failed send.
        // eslint-disable-next-line no-console
        console.error('[TelegramBridge.#postReply]', err?.message ?? err);
      }
    }
  }

  /**
   * Q-H2.4 addressed-only filter.  See class jsdoc for the rules.
   *
   * @param {any} ctx
   * @returns {boolean}
   */
  #isAddressed(ctx) {
    const chatType = ctx?.chat?.type;
    if (chatType === 'private') return true;

    const text = ctx?.message?.text;
    if (typeof text === 'string' && this.#botUsername) {
      const prefix = '@' + this.#botUsername.toLowerCase();
      if (text.toLowerCase().startsWith(prefix)) return true;
    }

    const replyTo = ctx?.message?.reply_to_message;
    if (replyTo) {
      const fromUid = String(replyTo.from?.id ?? '');
      const botUid  = String(ctx?.botInfo?.id ?? this.#bot?.botInfo?.id ?? '');
      if (botUid && fromUid && fromUid === botUid) return true;
      // Username fallback (the test fake may not set the numeric id)
      const fromUser = (replyTo.from?.username ?? '').toLowerCase();
      if (this.#botUsername && fromUser === this.#botUsername.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  /**
   * Strip a leading `@<botUsername>` mention (case-insensitive,
   * any following whitespace also collapsed) so the agent's regex
   * / LLM path sees `add bread` instead of `@bot add bread`.
   *
   * @param {string} text
   * @returns {string}
   */
  #stripMention(text) {
    if (!this.#botUsername) return text;
    const prefix = '@' + this.#botUsername;
    const lower  = text.toLowerCase();
    if (lower.startsWith(prefix.toLowerCase())) {
      return text.slice(prefix.length).replace(/^\s+/, '');
    }
    return text;
  }

  /**
   * @param {any} ctx
   * @returns {import('../types.js').Sender}
   */
  #mapSender(ctx) {
    const from = ctx?.from ?? ctx?.update?.callback_query?.from ?? {};
    const first = from.first_name ?? '';
    const last  = from.last_name  ? ' ' + from.last_name : '';
    return {
      displayName: (first + last).trim() || from.username || String(from.id ?? ''),
      bridgeUid:   String(from.id ?? ''),
      webid:       null, // resolved later in Phase 2
    };
  }
}

export default TelegramBridge;
