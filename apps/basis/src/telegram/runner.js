/**
 * The Telegram runner — basis's third shell, over a MessagingBridge.
 *
 * A shell does composition and paint: a turn that arrives on the bridge goes through the SAME
 * compilers the web and mobile shells use — `parseInput` → `resolveDispatch` → `runDispatch` →
 * `renderReply` — and the rendered reply is painted as bridge messages (text + inline buttons).
 * A button tap comes back as its `callbackData` (`opId:itemId`) and is dispatched like a typed
 * `/command item`. A command missing a required field asks for it and completes on the next line;
 * a command that must be confirmed offers two buttons. There is no command table here and no verb.
 *
 * Pairing: a chat must be on the allow-list; any other chat is told its id and refused. Free text
 * takes the SAME assistant as a typed circle line (`createAssistantEngine`): the deterministic gate
 * first (an "add X" / "done X" verb routes without any model), retrieval over the node's items, the
 * last turns of this chat re-sent as memory, then the interpreter when an LLM route is wired; with
 * no route, the help hint — never silence.
 *
 * Pure over its deps: any `MessagingBridge` (`@onderling/chat-agent`'s Telegram bridge in
 * production, the in-memory one in tests), any `callSkill`.
 */
import { parseInput }      from '../parser.js';
import { resolveDispatch } from '../router.js';
import { runDispatch }     from '../dispatch.js';
import { renderReply }     from '../renderer.js';
import { beginFollowUp, beginFormFollowUp, completeFollowUp, completeMultiFieldFollowUp } from '@onderling/kring-host/followUp';
import { createAssistantEngine } from '../v2/assistantEngine.js';
import { householdListType } from '../v2/circleGate.js';

const CONFIRM_YES = '__confirm:yes';
const CONFIRM_NO  = '__confirm:no';

/**
 * @param {object} a
 * @param {object} a.bridge              a MessagingBridge (start/stop/onMessage/sendReply)
 * @param {(app:string, op:string, args:object) => Promise<any>} a.callSkill
 * @param {object} a.catalogue           the merged catalogue (`mergeManifests`)
 * @param {Object<string, object>} [a.manifestsByOrigin]  appOrigin → manifest (list buttons need it)
 * @param {Array<string>|'*'} [a.allowedChatIds]  the paired chats; `'*'` (or an empty list) admits EVERY chat — the
 *   open-door mode for a first try; a list pairs exactly those chats and tells any other chat its id
 * @param {(key:string, params?:object) => string} a.t
 * @param {(chatId:string) => string} [a.threadFor]  the thread id a chat maps to (default: the chat id)
 * @param {{evaluate:Function}|null} [a.gate]        (tests) an engine override — see `engine` below
 * @param {Function|null} [a.interpret]              the NL→op interpreter (`interpretToCommand`) — only with an LLM route
 * @param {object|null} [a.llm]                      the LlmClient the interpreter runs on (the confidential route); null → basic mode
 * @param {Function} [a.loadItems]                   the items retrieval may draw on (`loadAssistantItems`)
 * @param {object} [a.engine]                        (tests) a pre-built assistant engine
 * @param {string} [a.botName]
 * @param {(entry: object) => void} [a.walkLog]  a sink for one record per turn — what came in, which path
 *   the turn took (slash · tap · form · confirm · gate rule · llm · hint), what was dispatched, what went
 *   back, how long it took — so a walk can be read afterwards instead of retold. Chat ids are shortened.
 */
export function createTelegramRunner({ bridge, callSkill, catalogue, manifestsByOrigin = {}, allowedChatIds = [], t, threadFor = (chatId) => `tg:${chatId}`, gate = null, interpret = null, llm = null, botName = 'assistant', walkLog = null, loadItems = null, engine: engineIn = null, lang = 'nl' } = {}) {
  if (!bridge || typeof bridge.onMessage !== 'function' || typeof bridge.sendReply !== 'function') throw new TypeError('createTelegramRunner: a MessagingBridge is required');
  if (typeof callSkill !== 'function') throw new TypeError('createTelegramRunner: callSkill is required');
  if (!catalogue) throw new TypeError('createTelegramRunner: a catalogue is required');
  if (typeof t !== 'function') throw new TypeError('createTelegramRunner: t is required');

  const open = allowedChatIds === '*' || !Array.isArray(allowedChatIds) || allowedChatIds.length === 0;
  const allowed = new Set(open ? [] : allowedChatIds.map(String));
  /** chatId → a pending follow-up (single/multi field) or a pending confirmation. */
  const pending = new Map();

  /** The turn under way (one per chat at a time) — the walk log's record in the making. */
  const turns = new Map();
  const note = (chatId, patch) => { const t0 = turns.get(chatId); if (t0) Object.assign(t0, patch); };
  const say = (chatId, text, buttons) => {
    const t0 = turns.get(chatId); if (t0) (t0.replies ??= []).push({ text, ...(buttons?.length ? { buttons: buttons.map((b) => b.id) } : {}) });
    return bridge.sendReply({ chatId, text, ...(buttons?.length ? { buttons } : {}) });
  };

  /** Paint a RenderedReply as bridge messages. */
  async function paint(chatId, rendered) {
    if (!rendered) return;
    if (rendered.kind === 'list') {
      const items = Array.isArray(rendered.items) ? rendered.items : [];
      if (!items.length) { await say(chatId, rendered.text ?? t('circle.telegram.empty_list')); return; }
      const lines = items.map((it, i) => `${i + 1}. ${it.label}`);
      const buttons = [];
      // A button names the ITEM, not its row number ("Done: melk", not "Done 1") — read from a phone, the
      // number was a puzzle (walk 2). Long labels are cut; the row number stays as a tiebreaker.
      items.forEach((it, i) => {
        const name = String(it.label ?? '').trim();
        const short = name.length > 18 ? `${name.slice(0, 17)}…` : name;
        for (const b of (it.buttons ?? [])) buttons.push({ id: b.callbackData, label: items.length > 1 ? `${b.label}: ${short || i + 1}` : b.label });
      });
      await say(chatId, lines.join('\n'), buttons);
      return;
    }
    const text = rendered.text ?? (rendered.error ? rendered.error.message : '');
    if (text) await say(chatId, text);
  }

  /** Run a ready route and paint its reply. */
  async function run(chatId, ready) {
    let reply;
    note(chatId, { opId: ready.opId, args: ready.args ?? {}, appOrigin: ready.appOrigin });
    try { reply = await runDispatch(ready, callSkill); }
    catch (err) { note(chatId, { error: err?.message ?? String(err) }); await say(chatId, t('circle.telegram.error', { message: err?.message ?? String(err) })); return; }
    await paint(chatId, renderReply(reply, { t, appOrigin: ready.appOrigin, manifestsByOrigin }));
  }

  /** `/help` (and the `help` op): the commands this bot answers to, with their hints — from the catalogue. */
  function helpText() {
    const lines = (catalogue.commandMenu ?? []).map((e) => {
      const op = catalogue.opsById?.get?.(e.opId)?.op;
      const hint = op?.surfaces?.chat?.hint ?? op?.description ?? '';
      return hint ? `${e.command} — ${hint}` : e.command;
    });
    return lines.join('\n');
  }

  /**
   * A typed body like `/add boodschappen olie`: when the op's first required param is an enum and the
   * body's first word names one of its values (in any language the gate knows), split it — the enum
   * takes the word, the next string param takes the rest. Otherwise the body stays whole.
   */
  function splitTypedMatch(parse) {
    const m = parse?.args?._match;
    if (typeof m !== 'string' || !m.includes(' ')) return parse;
    const op = catalogue.opsById?.get?.(parse.opId)?.op;
    const params = Array.isArray(op?.params) ? op.params : [];
    const enumP = params.find((p) => p?.required && p.kind === 'enum' && Array.isArray(p.of));
    const textP = params.find((p) => p !== enumP && p?.required && p.kind === 'string');
    if (!enumP || !textP) return parse;
    const [first, ...rest] = m.trim().split(/\s+/);
    const value = enumP.of.includes(first) ? first : (householdListType(first) && enumP.of.includes(householdListType(first)) ? householdListType(first) : null);
    if (!value) return parse;
    const { _match, ...others } = parse.args;
    return { ...parse, args: { ...others, [enumP.name]: value, [textP.name]: rest.join(' ') } };
  }

  /** An enum arg named the way people say it ("boodschappen") → the declared value ("shopping"). */
  function coerceEnums(ready) {
    const op = catalogue.opsById?.get?.(ready.opId)?.op;
    const args = { ...(ready.args ?? {}) };
    for (const p of (op?.params ?? [])) {
      if (p?.kind !== 'enum' || !Array.isArray(p.of)) continue;
      const v = args[p.name];
      if (typeof v !== 'string' || p.of.includes(v)) continue;
      const alt = householdListType(v);
      if (alt && p.of.includes(alt)) args[p.name] = alt;
    }
    return { ...ready, args };
  }

  /** A button tap arrives as its callbackData `opId:itemId` — dispatch it like `/command item`. */
  function tapToParse(text, threadId) {
    const m = /^([A-Za-z][\w-]*):(.*)$/.exec(text);
    if (!m) return null;
    const op = catalogue.opsById?.get?.(m[1]);
    if (!op) return null;
    return { kind: 'slash', opId: m[1], args: m[2] ? { _match: m[2] } : {}, threadId };
  }

  /** Route a compiled `{opId, args}` (a gate rule or the interpreter's pick) — like a button tap. */
  function opToParse({ opId, args, appOrigin }, threadId) {
    return { kind: 'slash', opId, args: args ?? {}, threadId, ...(appOrigin ? { appOrigin } : {}) };
  }

  async function route(chatId, threadId, text) {
    if (typeof text === 'string' && /^\/(help|hulp)$/i.test(text.trim())) { note(chatId, { via: 'slash', route: 'help' }); return say(chatId, helpText()); }
    let parse = typeof text === 'string'
      ? (tapToParse(text, threadId) ?? parseInput(text, catalogue, { threadId }))
      : opToParse(text, threadId);
    if (typeof text === 'string') note(chatId, { via: tapToParse(text, threadId) ? 'tap' : 'slash' });
    if (parse?.kind === 'slash') parse = splitTypedMatch(parse);
    if (parse?.kind === 'slash' && parse.opId === 'help') { note(chatId, { route: 'help' }); return say(chatId, helpText()); }
    const r = resolveDispatch(parse, catalogue);
    note(chatId, { route: r?.kind });
    switch (r?.kind) {
      case 'ready':
        return run(chatId, coerceEnums(r));
      case 'needsForm': {
        const single = beginFollowUp({ dispatch: r, t });
        const p = single ?? beginFormFollowUp({ dispatch: r, t });
        if (!p) return say(chatId, t('circle.telegram.unknown'));
        if (p.kind === 'multi') p.values = {};
        pending.set(chatId, { kind: 'form', p });
        const fields = p.kind === 'single' ? p.missingParam : p.fields.map((f) => f.name).join(', ');
        return say(chatId, `${t('circle.telegram.needs_form', { fields })}\n${p.kind === 'single' ? p.promptText : p.fields[0].label}`);
      }
      case 'needsConfirm': {
        pending.set(chatId, { kind: 'confirm', ready: { ...r, kind: 'ready' } });
        return say(chatId, t('circle.telegram.confirm', { message: r.message ?? '' }), [
          { id: CONFIRM_YES, label: t('circle.telegram.confirm_yes') },
          { id: CONFIRM_NO,  label: t('circle.telegram.confirm_no') },
        ]);
      }
      case 'ambiguous':
        return say(chatId, t('circle.telegram.unknown'), (r.choices ?? []).map((c) => ({ id: typeof c === 'string' ? c : c.command, label: typeof c === 'string' ? c : c.command })));
      case 'error':
        return say(chatId, t('circle.telegram.error', { message: r.message ?? r.code ?? '' }));
      default:
        return say(chatId, t('circle.telegram.unknown'));
    }
  }

  // Free text: the same assistant the circle composer uses — gate, retrieval, memory, interpreter — with
  // its dispatch pointed at this shell's router. A private Telegram chat IS addressed; the engine tags it.
  const engine = engineIn ?? createAssistantEngine({
    catalogue, lang, llm, interpret, loadItems, botName,
    ...(gate ? { gate } : {}),
    dispatch: (input, ctx) => route(ctx.chatId, ctx.id, input),
    onUnhandled: async (_text, ctx) => { await say(ctx.chatId, t('circle.telegram.unknown')); return 'hint'; },
    onLlmUnavailable: (_text, ctx) => say(ctx.chatId, t('circle.telegram.unknown')),
    onNoMatch: (_text, ctx, extra) => say(ctx.chatId, extra?.reply || t('circle.telegram.unknown')),
  });

  /** Continue a pending follow-up or confirmation with this line; false when nothing was pending. */
  async function continuePending(chatId, text) {
    const pend = pending.get(chatId);
    if (!pend) return false;
    if (pend.kind === 'confirm') {
      if (text !== CONFIRM_YES && text !== CONFIRM_NO) return false;   // something else — leave the confirm standing
      pending.delete(chatId); note(chatId, { via: 'confirm', confirmed: text === CONFIRM_YES });
      if (text === CONFIRM_YES) await run(chatId, pend.ready);
      return true;
    }
    if (text.startsWith('/')) { pending.delete(chatId); return false; }   // a new command cancels the ask
    pending.delete(chatId); note(chatId, { via: 'form' });
    if (pend.p.kind === 'single') { await run(chatId, completeFollowUp({ pending: pend.p, text })); return true; }
    // multi: one field per line, in order
    const p = pend.p;
    const next = p.fields[Object.keys(p.values).length];
    p.values[next.name] = text;
    if (Object.keys(p.values).length < p.fields.length) {
      pending.set(chatId, pend);
      await say(chatId, p.fields[Object.keys(p.values).length].label);
      return true;
    }
    await run(chatId, completeMultiFieldFollowUp({ pending: p, values: p.values }));
    return true;
  }

  async function handle(msg) {
    const chatId = String(msg?.chatId ?? '');
    const text = String(msg?.text ?? '').trim();
    if (!chatId || !text) return;
    if (!open && !allowed.has(chatId)) { await say(chatId, t('circle.telegram.not_paired', { chatId })); return; }
    const threadId = threadFor(chatId);
    const started = Date.now();
    turns.set(chatId, { ts: new Date(started).toISOString(), chat: chatId.slice(-4), text });
    try {
      if (await continuePending(chatId, text)) return;
      if (text.startsWith('/') || tapToParse(text, threadId)) { await route(chatId, threadId, text); return; }
      const r = await engine.ask(threadId, text, { chatId });
      note(chatId, { via: r?.via === 'rule' ? 'gate' : (r?.via ?? 'hint'), ...(r?.cmd ? { picked: r.cmd } : {}) });
    } catch (err) {
      note(chatId, { error: err?.message ?? String(err) });
      await say(chatId, t('circle.telegram.error', { message: err?.message ?? String(err) }));
    } finally {
      const rec = turns.get(chatId); turns.delete(chatId);
      // What the model gets to remember: the line as typed and what went back (buttons aside).
      if (rec && !/^(__confirm:|[A-Za-z][\w-]*:)/.test(text)) engine.remember(threadId, 'you', text);
      // An op's result is the SYSTEM speaking; only a model reply is the assistant's own words.
      const voice = rec?.opId || rec?.route === 'help' ? 'system' : 'assistant';
      for (const r of rec?.replies ?? []) engine.remember(threadId, voice, r.text);
      if (rec && typeof walkLog === 'function') { try { walkLog({ ...rec, ms: Date.now() - started }); } catch { /* a log must never break a turn */ } }
    }
  }

  bridge.onMessage(handle);
  return {
    handle,
    start: () => bridge.start(),
    stop:  () => bridge.stop(),
    /** test seam: the memory lines for a thread. */
    recentTurns: (threadId) => engine.recentTurns(threadId),
    /** test seam: is a follow-up or confirmation pending for this chat? */
    pendingFor: (chatId) => pending.get(String(chatId))?.kind ?? null,
  };
}
