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
import { doorDisclosure } from '../v2/turnLog.js';
import { renderReply }     from '../renderer.js';
import { beginFollowUp, beginFormFollowUp, completeFollowUp, completeMultiFieldFollowUp } from '@onderling/kring-host/followUp';
import { createAssistantEngine, assistantReplyText } from '../v2/assistantEngine.js';
import { householdListType, coerceListArgs } from '../v2/circleGate.js';

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
 * @param {(who:{channel:string, uid:string, displayName:string|null}) => Promise<string|null>} [a.admit]  the host's
 *   door: admits the person behind a message and returns their caller id. Every call the turn makes then carries it
 *   (`callSkill(app, op, args, {caller})`) and the host's gate checks it. A door without it calls as the host.
 * @param {{evaluate:Function}|null} [a.gate]        (tests) an engine override — see `engine` below
 * @param {Function|null} [a.interpret]              the NL→op interpreter (`interpretToCommand`) — only with an LLM route
 * @param {object|null} [a.llm]                      the LlmClient the interpreter runs on (the confidential route); null → basic mode
 * @param {Function} [a.loadItems]                   the items retrieval may draw on (`loadAssistantItems`)
 * @param {object} [a.engine]                        (tests) a pre-built assistant engine
 * @param {number} [a.collectMs]                     the engine's collect window (default `assistant.collectMs`)
 * @param {string} [a.botName]
 * @param {(entry: object) => void} [a.walkLog]  a sink for one record per turn — what came in, which path
 *   the turn took (slash · tap · form · confirm · gate rule · llm · hint), what was dispatched, what went
 *   back, how long it took — so a walk can be read afterwards instead of retold. Chat ids are shortened.
 */
export function createTelegramRunner({ bridge, callSkill, catalogue: catalogueIn, manifestsByOrigin: manifestsIn = {}, allowedChatIds = [], t, threadFor = (chatId) => `tg:${chatId}`, gate = null, interpret = null, llm = null, botName = 'assistant', walkLog = null, loadItems = null, engine: engineIn = null, lang = 'nl', collectMs, admit = null, threads = null, turnLogMode, promptLines = null, roleFor = null, scopeToRole = null, gateRules = null, hintsFor = null, expand = null } = {}) {
  if (!bridge || typeof bridge.onMessage !== 'function' || typeof bridge.sendReply !== 'function') throw new TypeError('createTelegramRunner: a MessagingBridge is required');
  if (typeof callSkill !== 'function') throw new TypeError('createTelegramRunner: callSkill is required');
  if (!catalogueIn) throw new TypeError('createTelegramRunner: a catalogue is required');
  // Static, or a getter: a door whose admin switches apps recomposes its catalogue, and every surface reads the new one.
  const catalogueOf = () => (typeof catalogueIn === 'function' ? catalogueIn() : catalogueIn);
  const manifestsOf = () => (typeof manifestsIn === 'function' ? manifestsIn() : manifestsIn);
  if (typeof t !== 'function') throw new TypeError('createTelegramRunner: t is required');

  const open = allowedChatIds === '*' || !Array.isArray(allowedChatIds) || allowedChatIds.length === 0;
  const allowed = new Set(open ? [] : allowedChatIds.map(String));
  /** threadId → a pending follow-up (single/multi field) or a pending confirmation — on the thread's row when the
   *  door keeps its threads (it survives a restart), else for this process. */
  const pending = threads
    ? { get: (id) => threads.pendingOf(id), set: (id, v) => threads.setPending(id, v), delete: (id) => threads.setPending(id, null) }
    : new Map();

  /** The turn under way (one per chat at a time) — the walk log's record in the making. */
  const turns = new Map();
  const note = (chatId, patch) => { const t0 = turns.get(chatId); if (t0) Object.assign(t0, patch); };
  const say = (chatId, text, buttons) => {
    const t0 = turns.get(chatId); if (t0) (t0.replies ??= []).push({ text, ...(buttons?.length ? { buttons: buttons.map((b) => b.id) } : {}) });
    return bridge.sendReply({ chatId, text, ...(buttons?.length ? { buttons } : {}) });
  };

  /** Paint a RenderedReply as bridge messages. */
  /**
   * The ops this chat's person may be OFFERED: their role's map (the same scoping their tools get), or null — no map,
   * everything the catalogue holds. A button for an op off the map would be refused on tap; it is never shown.
   */
  function offeredOps(chatId) {
    if (typeof roleFor !== 'function' || typeof scopeToRole !== 'function') return null;
    const rec = turns.get(chatId);
    const scoped = scopeToRole(catalogueOf(), roleFor(rec?.caller ?? rec?.thread ?? threadFor(chatId)));
    const ops = new Set();
    for (const [key, entry] of scoped?.opsById ?? []) ops.add(entry?.op?.id ?? key);
    return ops;
  }

  async function paint(chatId, rendered) {
    if (!rendered) return;
    const offered = offeredOps(chatId);
    const onMap = (b) => !offered || offered.has(String(b?.callbackData ?? '').split(':')[0]);
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
        for (const b of (it.buttons ?? []).filter(onMap)) buttons.push({ id: b.callbackData, label: items.length > 1 ? `${b.label}: ${short || i + 1}` : b.label });
      });
      await say(chatId, lines.join('\n'), buttons);
      return;
    }
    const text = rendered.text ?? (rendered.error ? rendered.error.message : '');
    if (text) await say(chatId, text);
  }

  /** Run a ready route and paint its reply. */
  /** The call for this chat's turn: it carries the person, so the host's gate decides what they reach. */
  function callFor(chatId) {
    const rec = turns.get(chatId);
    const caller = rec?.caller ?? null;
    const threadId = rec?.thread ?? null;
    return caller || threadId
      ? (app, op, args) => callSkill(app, op, args, { ...(caller ? { caller } : {}), ...(threadId ? { threadId } : {}) })
      : callSkill;
  }

  /** A read the model asked for, run through the same gated call as any op but not shown (the turn acts on it). */
  async function peekOp(chatId, threadId, cmd) {
    const r = resolveDispatch(splitTypedMatch(opToParse(cmd, threadId)), catalogueOf());
    if (r?.kind !== 'ready') return null;
    note(chatId, { peeked: r.opId });
    return runDispatch(coerceEnums(r), callFor(chatId));
  }

  async function run(chatId, ready) {
    let reply;
    note(chatId, { opId: ready.opId, args: ready.args ?? {}, appOrigin: ready.appOrigin });
    // The person this turn is for: every call carries them, so the host's gate decides what they reach.
    try { reply = await runDispatch(ready, callFor(chatId)); }
    catch (err) { note(chatId, { error: err?.message ?? String(err) }); await say(chatId, t('circle.telegram.error', { message: err?.message ?? String(err) })); return; }
    await paint(chatId, renderReply(reply, { t, appOrigin: ready.appOrigin, manifestsByOrigin: manifestsOf() }));
  }

  /** `/help` (and the `help` op): the commands this bot answers to, with their hints — from the catalogue. */
  function helpText() {
    const lines = (catalogueOf().commandMenu ?? []).map((e) => {
      const op = catalogueOf().opsById?.get?.(e.opId)?.op;
      const hint = op?.surfaces?.chat?.hint ?? op?.description ?? '';
      return hint ? `${e.command} — ${hint}` : e.command;
    });
    // How to turn memory off, always; and, when turns are logged, that they are.
    const disclosure = doorDisclosure(turnLogMode, t);
    return [...lines, '', t('circle.bot.help_memory'), ...(disclosure ? [disclosure] : [])].join('\n');
  }

  /**
   * A typed body like `/add boodschappen olie`: when the op's first required param is an enum and the
   * body's first word names one of its values (in any language the gate knows), split it — the enum
   * takes the word, the next string param takes the rest. Otherwise the body stays whole.
   */
  function splitTypedMatch(parse) {
    const m = parse?.args?._match;
    if (typeof m !== 'string' || !m.includes(' ')) return parse;
    const op = catalogueOf().opsById?.get?.(parse.opId)?.op;
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
  const coerceEnums = (ready) => coerceListArgs(ready, catalogueOf());

  /**
   * A button tap arrives as its callbackData `opId:itemId` — dispatch it like `/command item`. Only an op OFFERED as a
   * button (`surfaces.ui.control === 'button'`, what the reply buttons are built from) can be tapped: the text of a tap
   * is typeable, and an op with no surface — the owner's recovery phrase, device enrolment — is on the manifest for the
   * host to call, never for a chat. Anything else falls through to the normal paths, which offer only what they offer.
   */
  function tapToParse(text, threadId) {
    const m = /^([A-Za-z][\w-]*):(.*)$/.exec(text);
    if (!m) return null;
    const op = catalogueOf().opsById?.get?.(m[1]);
    if (!op) return null;
    if ((op.op ?? op)?.surfaces?.ui?.control !== 'button') return null;
    return { kind: 'slash', opId: m[1], args: m[2] ? { _match: m[2] } : {}, threadId };
  }

  /** Route a compiled `{opId, args}` (a gate rule or the interpreter's pick) — like a button tap. */
  function opToParse({ opId, args, appOrigin }, threadId) {
    return { kind: 'slash', opId, args: args ?? {}, threadId, ...(appOrigin ? { appOrigin } : {}) };
  }

  async function route(chatId, threadId, text) {
    if (typeof text === 'string' && /^\/(help|hulp)$/i.test(text.trim())) { note(chatId, { via: 'slash', route: 'help' }); return say(chatId, helpText()); }
    let parse = typeof text === 'string'
      ? (tapToParse(text, threadId) ?? parseInput(text, catalogueOf(), { threadId }))
      : opToParse(text, threadId);
    if (typeof text === 'string') note(chatId, { via: tapToParse(text, threadId) ? 'tap' : 'slash' });
    if (parse?.kind === 'slash') parse = splitTypedMatch(parse);
    if (parse?.kind === 'slash' && parse.opId === 'help') { note(chatId, { route: 'help' }); return say(chatId, helpText()); }
    const r = resolveDispatch(parse, catalogueOf());
    note(chatId, { route: r?.kind });
    switch (r?.kind) {
      case 'ready':
        return run(chatId, coerceEnums(r));
      case 'needsForm': {
        const single = beginFollowUp({ dispatch: r, t });
        const p = single ?? beginFormFollowUp({ dispatch: r, t });
        if (!p) return say(chatId, t('circle.telegram.unknown'));
        if (p.kind === 'multi') p.values = {};
        pending.set(threadId, { kind: 'form', p });
        const fields = p.kind === 'single' ? p.missingParam : p.fields.map((f) => f.name).join(', ');
        // An enum field asks with BUTTONS: the declared values, named the way people say them.
        const op = catalogueOf().opsById?.get?.(r.opId)?.op;
        const askName = p.kind === 'single' ? p.missingParam : p.fields[0].name;
        const enumP = (op?.params ?? []).find((q) => q?.name === askName && q.kind === 'enum' && Array.isArray(q.of));
        const buttons = enumP ? enumP.of.map((v) => ({ id: v, label: t(`circle.telegram.list_${v}`) })) : undefined;
        return say(chatId, `${t('circle.telegram.needs_form', { fields })}\n${p.kind === 'single' ? p.promptText : p.fields[0].label}`, buttons);
      }
      case 'needsConfirm': {
        pending.set(threadId, { kind: 'confirm', ready: { ...r, kind: 'ready' } });
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
  // Every line of a chat goes through the engine's lane, one turn at a time: a line this shell handles itself (an
  // answer to its ask, a confirmation, a command, a button tap) is CLAIMED, so it waits its turn instead of racing
  // the turn before it; quick free-text lines are gathered into one turn by the engine's collect window.
  const engine = engineIn ?? createAssistantEngine({
    catalogue: catalogueOf, lang, llm, interpret, loadItems, botName,
    ...(threads ? { memory: threads.memory, threadLang: (id) => threads.langOf(id) } : {}),
    ...(promptLines ? { promptLines } : {}),
    ...(Array.isArray(gateRules) ? { gateRules } : {}),
    ...(typeof hintsFor === 'function' ? { threadHints: hintsFor } : {}),
    ...(typeof expand === 'function' ? { expand } : {}),
    // Each person sees their own tools (a household bot: a member's, or an admin's): the thread is the person.
    ...(typeof roleFor === 'function' && typeof scopeToRole === 'function'
      ? { catalogueFor: (threadId) => scopeToRole(catalogueOf(), roleFor(threadId)) }
      : {}),
    ...(gate ? { gate } : {}),
    ...(collectMs !== undefined ? { collectMs } : {}),
    dispatch: (input, ctx) => route(ctx.chatId, ctx.id, input),
    peek: (cmd, ctx) => peekOp(ctx.chatId, ctx.id, cmd),
    onUnhandled: async (_text, ctx) => { await say(ctx.chatId, t('circle.telegram.unknown')); return 'hint'; },
    onLlmUnavailable: (_text, ctx) => say(ctx.chatId, t('circle.telegram.unknown')),
    onNoMatch: (_text, ctx, extra) => say(ctx.chatId, assistantReplyText(extra, t, 'circle.telegram.unknown')),
    claim: (text, ctx) => (claims(ctx.chatId, ctx.id, text) ? () => doorLine(ctx.chatId, ctx.id, text) : null),
    around: (turn, run) => aroundTurn(turn, run),
  });

  /** Does this shell take the line itself? Asked when the line's turn comes, so an ask the turn before made counts. */
  function claims(chatId, threadId, text) {
    const pend = pending.get(threadId);
    if (pend && (pend.kind === 'form' || text === CONFIRM_YES || text === CONFIRM_NO)) return true;
    return text.startsWith('/') || Boolean(tapToParse(text, threadId));
  }
  /** A line this shell takes: the answer to its pending ask, else a command or a tap. */
  async function doorLine(chatId, threadId, text) {
    if (await continuePending(chatId, threadId, text)) return { via: 'door' };
    await route(chatId, threadId, text);
    return { via: 'door' };
  }

  /**
   * One turn's record and memory, inside the lane: what came in (the lines of a gathered turn, as one text), the path,
   * what went back — then what the model gets to remember: the turn as the member sent it and the replies.
   */
  async function aroundTurn({ threadId, lines, ctx, own }, run) {
    const chatId = ctx.chatId;
    const text = lines.map((l) => String(l ?? '').trim()).join('\n');
    const started = Date.now();
    turns.set(chatId, { ts: new Date(started).toISOString(), chat: chatId.slice(-4), text, ...(lines.length > 1 ? { lines: lines.length } : {}), ...(ctx.caller ? { caller: ctx.caller } : {}), thread: threadId });
    let r;
    try {
      await greetOnce(chatId, threadId);
      r = await run();
      if (!own) note(chatId, { via: r?.via === 'rule' ? 'gate' : (r?.via ?? 'hint'), ...(r?.cmd ? { picked: r.cmd } : {}) });
    } catch (err) {
      note(chatId, { error: err?.message ?? String(err) });
      await say(chatId, t('circle.telegram.error', { message: err?.message ?? String(err) }));
    } finally {
      const rec = turns.get(chatId); turns.delete(chatId);
      if (rec && !/^(__confirm:|[A-Za-z][\w-]*:)/.test(text)) engine.remember(threadId, 'you', text);
      // An op's result is the SYSTEM speaking; only a model reply is the assistant's own words.
      const voice = rec?.opId || rec?.route === 'help' ? 'system' : 'assistant';
      for (const reply of rec?.replies ?? []) engine.remember(threadId, voice, reply.text);
      // The log keeps the chat's last digits, never the person's id.
      if (rec && typeof walkLog === 'function') { try { const { caller: _who, thread: _thread, ...logged } = rec; walkLog({ ...logged, ms: Date.now() - started }); } catch { /* a log must never break a turn */ } }
    }
    return r;
  }

  /** A person's first turn with this door: who it is and what it keeps — once. */
  // The chats that came in on a door without commands (the bot's contact inbox): their welcome does not say "typ /help".
  const slashless = new Set();
  async function greetOnce(chatId, threadId) {
    if (!threads || !threadId || threads.greeted(threadId)) return;
    const disclosure = doorDisclosure(turnLogMode, t);
    const welcome = slashless.has(String(chatId)) ? t('circle.bot.welcome_talk') : t('circle.bot.welcome');
    await say(chatId, [welcome, ...(disclosure ? [disclosure] : [])].join('\n'));
    threads.markGreeted(threadId);
  }

  /** Continue a pending follow-up or confirmation with this line; false when nothing was pending. */
  async function continuePending(chatId, threadId, text) {
    const pend = pending.get(threadId);
    if (!pend) return false;
    if (pend.kind === 'confirm') {
      if (text !== CONFIRM_YES && text !== CONFIRM_NO) return false;   // something else — leave the confirm standing
      pending.delete(threadId); note(chatId, { via: 'confirm', confirmed: text === CONFIRM_YES });
      if (text === CONFIRM_YES) await run(chatId, pend.ready);
      return true;
    }
    if (text.startsWith('/')) { pending.delete(threadId); return false; }   // a new command cancels the ask
    pending.delete(threadId); note(chatId, { via: 'form' });
    // The answer is typed the way people say it ("boodschappen"): an enum field takes its declared value.
    if (pend.p.kind === 'single') { await run(chatId, coerceEnums(completeFollowUp({ pending: pend.p, text }))); return true; }
    // multi: one field per line, in order
    const p = pend.p;
    const next = p.fields[Object.keys(p.values).length];
    p.values[next.name] = text;
    if (Object.keys(p.values).length < p.fields.length) {
      pending.set(threadId, pend);
      await say(chatId, p.fields[Object.keys(p.values).length].label);
      return true;
    }
    await run(chatId, coerceEnums(completeMultiFieldFollowUp({ pending: p, values: p.values })));
    return true;
  }

  /** One incoming line: pairing, then the chat's lane. Resolves when the line's turn is done. */
  async function handle(msg) {
    const chatId = String(msg?.chatId ?? '');
    const text = String(msg?.text ?? '').trim();
    if (!chatId || !text) return;
    // A door that admits people decides who may talk (a code, its bootstrap ids); without one, the chat allow-list.
    if (typeof admit !== 'function' && !open && !allowed.has(chatId)) { await say(chatId, t('circle.telegram.not_paired', { chatId })); return; }
    // Who is asking: the person, not the chat (a group chat holds several). No admission, no turn.
    let caller = null;
    if (typeof admit === 'function') {
      let r = null;
      try {
        r = await admit({
          channel: msg?.channel ?? 'telegram', uid: String(msg?.sender?.bridgeUid || chatId),
          displayName: msg?.sender?.displayName ?? null, text,
          ...(typeof msg?.admission === 'string' ? { admission: msg.admission } : {}),
        });
      } catch { r = null; }
      // Refused: the reason, and nothing else — never the chat's id.
      if (r && typeof r === 'object' && r.refused) {
        // A door that tells a stranger once (the bot's inbox): "you need a code" the first time, kept on their row, then
        // silence. A message that carried a code is told why it failed, every time: that is a new question.
        if (msg?.refuseOnce && threads && r.id && r.refused === 'needs-code') {
          if (threads.refused(r.id)) return;
          threads.markRefused(r.id);
        }
        await say(chatId, t(`circle.bot.admission_${String(r.refused).replace(/-/g, "_")}`));
        return;
      }
      caller = typeof r === 'string' ? r : (r && typeof r === 'object' ? r.id : null);
      if (!caller) { await say(chatId, t('circle.telegram.unknown')); return; }
      // The line was the code that admitted them: the welcome, and nothing to dispatch.
      if (r && typeof r === 'object' && r.consumed) {
        if (threads) await greetOnce(chatId, caller); else await say(chatId, t('circle.bot.welcome'));
        return;
      }
    }
    // The thread is the PERSON's when the door admits people (their contact id), so what one said is never another's
    // memory, in a group chat too; without admission, the chat's.
    await engine.ask(caller ?? threadFor(chatId), text, { chatId, ...(caller ? { caller } : {}) });
  }

  // The bridge is let go as soon as the line is in its lane: a long-polling bridge fetches the next updates only when
  // the handler returns, so holding it for the whole turn would keep the chat's next quick line (and every other
  // chat) waiting, and the lane could never gather or run anything side by side. Replies go out through `say`.
  // A line still being ADMITTED is not in a lane yet; `idle` waits for those too, or it would answer "nothing queued".
  const admitting = new Set();
  bridge.onMessage((msg) => {
    if (msg?.slash === false && msg?.chatId) slashless.add(String(msg.chatId));
    const p = handle(msg).catch(() => { /* a turn's error was already told to the chat */ });
    admitting.add(p);
    p.finally(() => admitting.delete(p));
  });
  return {
    handle,
    /** Resolves when every turn under way is done. */
    // Every lane, whatever the argument: a person's thread is keyed by who they are, not by the chat they wrote in.
    idle: async () => {
      while (admitting.size) await Promise.all([...admitting]);
      return engine.idle ? engine.idle() : undefined;
    },
    start: () => bridge.start(),
    stop:  () => bridge.stop(),
    /** test seam: the memory lines for a thread. */
    recentTurns: (threadId) => engine.recentTurns(threadId),
    /** test seam: is a follow-up or confirmation pending for this chat? */
    /** test seam: is a follow-up or confirmation pending — for a thread id, or a chat's own thread? */
    pendingFor: (id) => (pending.get(String(id)) ?? pending.get(threadFor(String(id))))?.kind ?? null,
  };
}
