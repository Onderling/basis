/**
 * BotPod — wrapper around `@onderling/pod-client` PodClient + (optional)
 * `@onderling/core` `OAuthVault`, scoped to the bot's own Solid pod.
 *
 * Per Q-H2.6 lock, the bot has its own pod, separate from the shared
 * household pod and per-member pods.  The bot's pod does NOT hold
 * user-facing items; it holds the bot's runtime state:
 *
 *   /bot/config.json                       — bot's runtime config
 *   /bot/audit/<yyyy-mm>.jsonl             — append-only LLM call audit
 *   /bot/chat-meta/<chatId>/cursor.json    — last-processed message id
 *   /bot/bot-token.enc                     — Telegram bot token (Track F1
 *                                            OAuthVault when injected)
 *
 * Encryption-by-ACL is handled by the pod-client; this wrapper just
 * supplies path conventions + JSON shape.
 *
 * @see Project Files/projects/07-household-app/programming-plan.md
 *      § "pods/BotPod.js"
 * @see Project Files/coding-plans/track-H-app-household.md
 *      § "Pod schema → Bot's pod governance"
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const TELEGRAM_OAUTH_SERVICE = 'telegram';
const BOT_TOKEN_PATH         = '/bot/bot-token.enc';
const CONFIG_PATH            = '/bot/config.json';
// Parameter register (#36) — default audit-log retention window (scope:device, kind:internal).
const DEFAULT_AUDIT_WINDOW_MS = param({ key: 'household.auditWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * 24 * 60 * 60 * 1000 }); // 30 days

/**
 * Format a Date (or ms epoch) as "YYYY-MM" in UTC.  Audit log files
 * are bucketed by UTC month so all hosts agree on the boundary
 * regardless of local timezone.
 *
 * @param {number|Date} input
 * @returns {string}
 */
function yyyymm(input) {
  const d = typeof input === 'number' ? new Date(input) : input;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Path helper for an audit-log file given a timestamp.
 *
 * @param {number} ts ms epoch
 * @returns {string}
 */
function auditPathFor(ts) {
  return `/bot/audit/${yyyymm(ts)}.jsonl`;
}

/**
 * Path helper for a chat cursor.
 *
 * @param {string} chatId
 * @returns {string}
 */
function cursorPathFor(chatId) {
  return `/bot/chat-meta/${chatId}/cursor.json`;
}

/**
 * Detect a "resource not found" error from the pod-client.  The
 * pod-client wraps source errors via `mapSourceCode`; the resulting
 * error carries `code === 'NOT_FOUND'`.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isNotFound(err) {
  return Boolean(err && typeof err === 'object' && /** @type {any} */ (err).code === 'NOT_FOUND');
}

export class BotPod {
  /** @type {import('@onderling/pod-client').PodClient} */
  #podClient;
  /** @type {string} */
  #podRoot;
  /** @type {object|null} */
  #oauthVault;

  /**
   * @param {object} args
   * @param {import('@onderling/pod-client').PodClient} args.podClient
   *   Already configured against the bot's pod root + auth.
   * @param {string} args.podRoot
   *   The bot's pod URL.  Stored for reference; the PodClient is what
   *   actually performs reads/writes (it already knows its podRoot).
   * @param {object} [args.oauthVault]
   *   Optional `OAuthVault` instance for bot-token storage.  When
   *   provided, BotPod uses it for `getBotToken` / `setBotToken`.
   *   When absent, the token is read/written via the pod-client at
   *   `/bot/bot-token.enc`.
   */
  constructor({ podClient, podRoot, oauthVault } = {}) {
    if (!podClient) throw new Error('BotPod: { podClient } is required');
    if (!podRoot)   throw new Error('BotPod: { podRoot } is required');
    this.#podClient   = podClient;
    this.#podRoot     = podRoot;
    this.#oauthVault  = oauthVault ?? null;
  }

  /** The bot's pod root URL.  Read-only. */
  get podRoot() { return this.#podRoot; }

  // ── /bot/config.json ─────────────────────────────────────────────────

  /**
   * Read `/bot/config.json`.  Returns `null` if the file does not yet
   * exist (cold-start).
   *
   * @returns {Promise<import('../types.js').BotConfig|null>}
   */
  async readConfig() {
    try {
      const res = await this.#podClient.read(CONFIG_PATH, { decode: 'json' });
      return res.content;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Write `/bot/config.json` (create or overwrite).  Encryption-by-ACL
   * is handled by the underlying pod-client.
   *
   * @param {import('../types.js').BotConfig} config
   */
  async writeConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('BotPod.writeConfig: config must be an object');
    }
    await this.#podClient.write(CONFIG_PATH, config, {
      contentType: 'application/json',
      // Config is small + the only writer is the bot itself; if a
      // collision happens (admin tool + bot at the same time) we
      // prefer not to silently lose changes — let the caller resolve.
      conflictPolicy: 'reject',
    });
  }

  // ── /bot/audit/<yyyy-mm>.jsonl ───────────────────────────────────────

  /**
   * Append an entry to `/bot/audit/<yyyy-mm>.jsonl`.  Phase 3's LLM
   * client calls this on every `invoke()`.  Each entry is one JSON
   * object on one line.
   *
   * `ts` is taken from `entry.ts` if present (so callers can supply
   * a deterministic timestamp), otherwise from `Date.now()`.  The
   * destination file is the UTC-month bucket containing that ts.
   *
   * Creates the file (and underlying container) on first append.
   *
   * @param {object} entry  free-shape; common fields: ts, kind, input, output, providerMeta
   */
  async appendAudit(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('BotPod.appendAudit: entry must be an object');
    }
    const ts = typeof entry.ts === 'number' ? entry.ts : Date.now();
    const stamped = entry.ts === ts ? entry : { ...entry, ts };
    const uri  = auditPathFor(ts);
    // PodClient.append: read-modify-write with retry + 404→start-fresh.
    // The pod-client handles missing-file as "start with empty body".
    await this.#podClient.append(uri, JSON.stringify(stamped), {
      contentType: 'application/x-ndjson',
    });
  }

  /**
   * Read all audit entries since `sinceMs` (default: 30 days ago).
   * Walks the relevant `/bot/audit/<yyyy-mm>.jsonl` files for the
   * window — typically the current UTC month and the previous one to
   * cover wrap-around — parses lines, and filters in-memory.
   *
   * Inefficient for very large logs but acceptable for v0
   * (~<100 entries/day per household).
   *
   * @param {number} [sinceMs]
   * @returns {Promise<Array<object>>}
   */
  async listAuditSince(sinceMs) {
    const cutoff = typeof sinceMs === 'number'
      ? sinceMs
      : Date.now() - DEFAULT_AUDIT_WINDOW_MS;

    // Walk every UTC-month bucket from the cutoff month up to the
    // current month.  In v0 this is at most ~2 buckets (default 30-day
    // window) but the loop handles arbitrary windows correctly.
    const buckets = new Set();
    const cursor = new Date(cutoff);
    cursor.setUTCDate(1);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date();
    end.setUTCDate(1);
    end.setUTCHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime()) {
      buckets.add(yyyymm(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    const entries = [];
    for (const bucket of buckets) {
      const uri = `/bot/audit/${bucket}.jsonl`;
      let body = '';
      try {
        const res = await this.#podClient.read(uri, { decode: 'string' });
        body = typeof res.content === 'string' ? res.content : '';
      } catch (err) {
        if (isNotFound(err)) continue; // bucket doesn't exist yet — skip
        throw err;
      }
      if (!body) continue;
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try { parsed = JSON.parse(trimmed); }
        catch { continue; } // tolerate corrupt lines — skip silently
        if (typeof parsed?.ts === 'number' && parsed.ts < cutoff) continue;
        entries.push(parsed);
      }
    }
    return entries;
  }

  // ── /bot/chat-meta/<chatId>/cursor.json ──────────────────────────────

  /**
   * Read `/bot/chat-meta/<chatId>/cursor.json`.  Returns `null` if not
   * yet recorded (cold start).
   *
   * @param {string} chatId
   * @returns {Promise<{ lastMessageId: string, ts: number }|null>}
   */
  async readChatCursor(chatId) {
    if (!chatId) throw new Error('BotPod.readChatCursor: chatId is required');
    try {
      const res = await this.#podClient.read(cursorPathFor(chatId), { decode: 'json' });
      return res.content;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Write `/bot/chat-meta/<chatId>/cursor.json`.  Used by the
   * Telegram adapter on every processed message so a restart doesn't
   * re-scan history.
   *
   * @param {string} chatId
   * @param {{ lastMessageId: string, ts: number }} cursor
   */
  async writeChatCursor(chatId, cursor) {
    if (!chatId) throw new Error('BotPod.writeChatCursor: chatId is required');
    if (!cursor || typeof cursor !== 'object') {
      throw new Error('BotPod.writeChatCursor: cursor must be an object');
    }
    await this.#podClient.write(cursorPathFor(chatId), cursor, {
      contentType: 'application/json',
      // Cursors are write-many, last-write-wins by intent — a later
      // cursor strictly supersedes an earlier one within a chat.
      conflictPolicy: 'lww',
    });
  }

  // ── /bot/bot-token.enc (or OAuthVault) ───────────────────────────────

  /**
   * Get the Telegram bot token.  Reads from the OAuthVault if one was
   * injected (under service `'telegram'`), else reads
   * `/bot/bot-token.enc` directly via the pod-client.
   *
   * Returns `null` if no token has been stored yet.
   *
   * @returns {Promise<string|null>}
   */
  async getBotToken() {
    if (this.#oauthVault) {
      const bundle = await this.#oauthVault.getTokens(TELEGRAM_OAUTH_SERVICE);
      return bundle?.access ?? null;
    }
    try {
      const res = await this.#podClient.read(BOT_TOKEN_PATH, { decode: 'string' });
      const text = typeof res.content === 'string' ? res.content : '';
      return text.length ? text : null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Set / replace the Telegram bot token.  Writes via OAuthVault if
   * available; otherwise writes `/bot/bot-token.enc` directly (the
   * pod-client handles encryption-by-ACL).
   *
   * @param {string} token
   */
  async setBotToken(token) {
    if (typeof token !== 'string' || !token) {
      throw new Error('BotPod.setBotToken: token must be a non-empty string');
    }
    if (this.#oauthVault) {
      // Telegram bot tokens are long-lived static credentials — no
      // refresh-token, no expiry.  Store as the access token of a
      // single-account bundle.
      await this.#oauthVault.storeTokens(TELEGRAM_OAUTH_SERVICE, null, { access: token });
      return;
    }
    await this.#podClient.write(BOT_TOKEN_PATH, token, {
      contentType: 'text/plain',
      conflictPolicy: 'lww',
    });
  }
}

export default BotPod;
