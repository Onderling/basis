// v2 circle free-text → dispatch — the ONE platform-neutral turn engine for a typed turn in a circle
// (web↔mobile consolidation Phase 4: web's circleTurn is now a thin adapter over this; the
// gate→interpret→dispatch loop lives here ONCE):
//   1. an explicit /slash command       → dispatch it (unless `dispatchSlash:false` — the web shell
//                                          already routes slash upstream, so it defers via onUnhandled)
//   2. free text + the circle's LLM on + the bot ADDRESSED (@tag/name) → gate (rule → dispatch; skip →
//                                          unhandled) else interpret via the circle LLM → dispatch
//   3. otherwise                         → the injected sink (mobile: post to the circle; web: defer)
//
// Platform-neutral: the shell injects HOW to dispatch (slash string OR {opId,args}), the "unhandled"
// sink, the catalogue, per-circle LLM providers, the policy (static OR a per-scope getter), and the
// NL→slash interpret. The household bot + the feedback v2 rewire reuse the same core — they differ only
// in the catalogue/interpret.

import { resolveCircleLlm } from './llmPicker.js';
import { scopeCatalogueToApps } from './circleCatalogueScope.js';
import { splitRecentTurns } from './circleMemory.js';

/**
 * @param {object} a
 * @param {object|(()=>object)} [a.catalogue]   the dispatch catalogue (LLM tool list); static or a getter
 * @param {object|((ctx:object)=>object|Promise<object>)} [a.policy]  the circle policy; static OR a per-scope getter (web's `policyFor`)
 * @param {object|(()=>object)} [a.userDefault]   the member's personal default (only when policy is 'user'); static or a getter
 * @param {{local?:object,cloud?:object}|null} [a.llmProviders] host-supplied LlmClients
 * @param {(text:string, opts:{catalogue,llm,context}) => Promise<{opId:string,args?:object}|null>} [a.interpret]  NL→slash
 * @param {(input:string|{opId:string,args:object}, ctx:object) => any} a.dispatch  run a typed slash STRING or an {opId,args} route
 * @param {(text:string, ctx:object) => any} [a.postToCircle]  back-compat sink: posts a circle message (→ the default onUnhandled, reports 'circle')
 * @param {(text:string, ctx:object) => (string|Promise<string>)} [a.onUnhandled]  handle slash(when dispatchSlash:false)/skip/no-match/not-addressed; returns the `via` ('circle' | 'defer' | 'none' | …)
 * @param {boolean} [a.dispatchSlash=true]  when false, a /command is NOT dispatched here (left to onUnhandled — the web shell routes slash itself)
 * @param {object} [a.gate]   optional token gate ({ evaluate })
 * @param {string} [a.botName='assistant']
 * @param {(cmd:{opId:string,args:object}, ctx:object) => Promise<any>} [a.peek]  run an op WITHOUT showing it (the door's
 *        gated call): a read the model picks is looked at and handed back to it once, so the turn can act on it
 * @param {(cmd:{opId:string,args:object,appOrigin?:string}) => object[]} [a.expand]  a door's rewrite of a chosen op
 *        into the ops it stands for (a household bot: one add per thing named) — the gate's and the model's alike
 * @param {(ctx:object) => any} [a.onSlow]  the model route is slow and retrying: tell the person to wait (their turn's ctx)
 */
export function createCircleDispatch({ catalogue, policy, userDefault, llmProviders, interpret, dispatch, postToCircle, onUnhandled, onNoMatch, onLlmUnavailable, dispatchSlash = true, gate, botName = 'assistant', recentTurns, peek = null, expand = null, onSlow = null }) {
  if (typeof dispatch !== 'function') {
    throw new Error('createCircleDispatch: dispatch is required');
  }
  const getCatalogue     = typeof catalogue === 'function' ? catalogue : () => catalogue;
  const getPolicy      = typeof policy === 'function' ? policy : () => policy;
  const getUserDefault = typeof userDefault === 'function' ? userDefault : () => userDefault;
  // The "everything-else" sink: an explicit onUnhandled, else a `postToCircle` (back-compat → posts +
  // reports 'circle'), else a no-op reporting 'none'.
  const unhandled = typeof onUnhandled === 'function'
    ? onUnhandled
    : (typeof postToCircle === 'function'
        ? async (text, ctx) => { await postToCircle(text, ctx); return 'circle'; }
        : () => 'none');
  const sink = async (text, ctx) => (await unhandled(text, ctx)) ?? 'none';
  // A gate rule's command, and the further items it names. Carries the rule's owning app so the resolver routes a
  // colliding bare op-id to the gate's app, not the merge's first-declarer.
  const expanded = (c) => (typeof expand === 'function' ? expand(c) : [c]);
  const slowFor = (ctx) => (typeof onSlow === 'function' ? { onSlow: () => onSlow(ctx) } : {});
  async function dispatchRule(command, ctx) {
    for (const c of expanded({ opId: command.opId, args: command.args || {}, appOrigin: command.appOrigin })) await dispatch(c, ctx);
    for (const m of (Array.isArray(command.more) ? command.more : [])) {
      if (m && m.opId) for (const c of expanded({ opId: m.opId, args: m.args || {}, appOrigin: m.appOrigin ?? command.appOrigin })) await dispatch(c, ctx);
    }
  }

  return {
    /** Route one typed turn. Returns `{ via: 'slash'|'rule'|'llm'|'circle'|'defer'|'none', cmd? }`. */
    async handle(text, ctx = {}) {
      const trimmed = String(text ?? '').trim();
      if (!trimmed) return { via: 'none' };

      // 1. explicit slash command → dispatch verbatim (unless the shell handles slash upstream).
      if (trimmed.startsWith('/')) {
        if (dispatchSlash) { await dispatch(trimmed, ctx); return { via: 'slash' }; }
        return { via: await sink(trimmed, ctx) };
      }

      // 2. free text + the bot addressed → gate (deterministic, works WITHOUT the LLM) → interpret
      //    (only when "smart chat" is available) → dispatch.
      const circlePolicy = await getPolicy(ctx);
      const llm = resolveCircleLlm({ circlePolicy, userDefault: getUserDefault(), providers: llmProviders });
      if (typeof interpret === 'function' && addressesBot(trimmed, botName)) {
        const stripped = stripBotTag(trimmed, botName);
        // Token gate (optional) — a cheap LOCAL pass that routes deterministic verbs ("add X", "done X")
        // WITHOUT the LLM. It runs whether or not smart chat is configured, so commands keep working in
        // "basic mode". A rule routes a command directly; a skip treats the turn as normal chat (→ sink).
        let context;
        let ranByRule = 0;   // ops a gate rule ran in this turn (a gathered turn's other lines)
        // A gathered turn (several lines, see assistantLane): the gate reads each line on its own, as it would have
        // read it alone. The lines a rule takes are dispatched by their rule; the others go to the model TOGETHER, as
        // one member message — so "melk" / "brood" / "eieren" is one model call. Lines only a skip rule claims are
        // left out of the model's message; when every line skips, the whole turn goes to the sink.
        const lines = stripped.split('\n').map((l) => l.trim()).filter(Boolean);
        let modelText = stripped;
        if (lines.length > 1 && gate && typeof gate.evaluate === 'function') {
          const verdicts = [];
          for (const line of lines) verdicts.push(await gate.evaluate(line, ctx));
          const ruled = verdicts.filter((g) => g.via === 'rule' && g.command?.opId).map((g) => g.command);
          for (const c of ruled) await dispatchRule(c, ctx);
          ranByRule = ruled.length;
          const rest = lines.filter((_l, i) => !(verdicts[i].via === 'rule' && verdicts[i].command?.opId) && verdicts[i].via !== 'skip');
          if (!rest.length) return ruled.length ? { via: 'rule', cmd: ruled[0], cmds: ruled } : { via: await sink(trimmed, ctx) };
          modelText = rest.join('\n');
          const ctxItems = [];
          for (const g of verdicts) for (const c of (Array.isArray(g.context) ? g.context : [])) if (!ctxItems.includes(c)) ctxItems.push(c);
          context = ctxItems;
        } else if (gate && typeof gate.evaluate === 'function') {
          const g = await gate.evaluate(stripped, ctx);
          if (g.via === 'rule' && g.command?.opId) {
            await dispatchRule(g.command, ctx);
            return { via: 'rule', cmd: g.command };
          }
          if (g.via === 'skip') return { via: await sink(trimmed, ctx) };
          context = g.context;
        }

        // The turn needs free-text UNDERSTANDING → the LLM, but only if smart chat is available.
        if (llm) {
          // Conversation memory, so follow-ups ("en schoenen ook", "that one") resolve against what was just said:
          // the member's and the assistant's turns as messages, an op's result as a context line.
          const remembered = splitRecentTurns(typeof recentTurns === 'function' ? (recentTurns() || []) : []);
          if (remembered.context.length) context = [...remembered.context, ...(Array.isArray(context) ? context : [])];
          // Part D — scope the LLM's tool list to the circle's apps. Gate/dispatch unaffected.
          const scopedCatalogue = scopeCatalogueToApps(getCatalogue(), circlePolicy?.apps);
          let cmd = null;
          try {
            // `ctx.history` carries a follow-up's prior turns (the bot's question + the original ask) so a
            // bare answer ("shopping") resolves against what was just asked. interpret threads it as messages.
            // A follow-up's own history (the bot's question + the ask) wins: it already carries those turns.
            const history = Array.isArray(ctx?.history) ? ctx.history : (remembered.history.length ? remembered.history : undefined);
            cmd = await interpret(modelText, { ...slowFor(ctx), catalogue: scopedCatalogue, llm, context, history });   // → {opId,args,partial?}|{reply}|{partial}|null
          } catch (err) {
            // Smart chat is configured but the endpoint is UNREACHABLE (server down). Reply in plain
            // words ("basic mode") rather than failing the turn — buttons + commands still work.
            if (typeof onLlmUnavailable === 'function') {
              await onLlmUnavailable(modelText, ctx, { reason: 'unreachable', error: err });
              return { via: 'llm-unavailable' };
            }
            throw err;   // no hook wired → preserve old behaviour
          }
          // A READ before the act ("melk is gekocht" → first the list): look at it, hand it back once, and do what the
          // model then picks. Asked only to see it, the model reads again and the read is shown — once, as before.
          // A REPLY that says something happened, when nothing ran: never shown. Asked once more; a second claim is "I did
          // not do that" (walk 2026-09-30: three "→ halfvolle melk ✓" lines, and nothing had changed).
          if (cmd && !cmd.opId && typeof cmd.reply === 'string' && !ranByRule && claimsResult(cmd.reply)) {
            const history = Array.isArray(ctx?.history) ? ctx.history : (remembered.history.length ? remembered.history : undefined);
            const again = await interpret(modelText, { ...slowFor(ctx), catalogue: scopedCatalogue, llm, context: [...(Array.isArray(context) ? context : []), NO_CLAIM_RETRY], history }).catch(() => null);
            if (again && (again.opId || (typeof again.reply === 'string' && again.reply && !claimsResult(again.reply)))) cmd = again;
            else {
              if (typeof onNoMatch === 'function') await onNoMatch(modelText, ctx, { notDone: true });
              return { via: 'llm-not-done' };
            }
          }
          if (cmd && cmd.opId && typeof peek === 'function' && !(Array.isArray(cmd.more) && cmd.more.length) && isRead(scopedCatalogue, cmd.opId)) {
            const seen = await Promise.resolve(peek({ opId: cmd.opId, args: cmd.args ?? {} }, ctx)).catch(() => null);
            const line = readLine(cmd, seen);
            if (line) {
              const history = Array.isArray(ctx?.history) ? ctx.history : (remembered.history.length ? remembered.history : undefined);
              const again = await interpret(modelText, { ...slowFor(ctx), catalogue: scopedCatalogue, llm, context: [...(Array.isArray(context) ? context : []), line, READ_THEN_ACT], history }).catch(() => null);
              if (again && again.opId && !isRead(scopedCatalogue, again.opId)) cmd = again;
            }
          }
          if (cmd && cmd.opId) {
            for (const c of expanded({ opId: cmd.opId, args: cmd.args && typeof cmd.args === 'object' ? cmd.args : {} })) await dispatch(c, ctx);
            // A member who names three items gets three acts in one turn — the further calls, in order.
            for (const m of (Array.isArray(cmd.more) ? cmd.more : [])) {
              if (m && m.opId) for (const c of expanded({ opId: m.opId, args: m.args && typeof m.args === 'object' ? m.args : {} })) await dispatch(c, ctx);
            }
            // The turn was cut (the per-turn cap, or a call the output cut off): ask the member for the rest.
            if (cmd.partial && typeof onNoMatch === 'function') await onNoMatch(modelText, ctx, { partial: true });
            return { via: 'llm', cmd };
          }
          // The LLM ran but mapped the message to NO tool. If it spoke a conversational reply (a clarifying
          // question / answer), SHOW that — the bot can converse — rather than a dead-end. Otherwise the
          // shell falls back to its generic "couldn't turn that into an action" via onNoMatch.
          const reply = cmd && typeof cmd.reply === 'string' && cmd.reply ? cmd.reply : null;
          const partial = !reply && cmd?.partial === true;   // every call was cut off: ask for it again
          if (typeof onNoMatch === 'function') { await onNoMatch(modelText, ctx, reply ? { reply } : partial ? { partial: true } : undefined); return reply ? { via: 'llm-reply', reply } : { via: 'llm-nomatch' }; }
          // couldn't map it to a command → fall through to the sink.
        } else {
          // Smart chat is OFF (not configured / circle opted out). The bot was addressed with free text the
          // gate couldn't route. Reply in plain words ("basic mode") instead of silently posting it as chat.
          if (typeof onLlmUnavailable === 'function') {
            await onLlmUnavailable(modelText, ctx, { reason: 'off' });
            return { via: 'llm-unavailable' };
          }
          // no hook wired → fall through to the sink (back-compat: silent post).
        }
      }

      // 3. everything else → the injected sink.
      return { via: await sink(trimmed, ctx) };
    },
  };
}

/** The one-shot retry after a reply that claimed a result. LLM-facing (Fable's text, verbatim). */
const NO_CLAIM_RETRY = 'Your last answer described a result without calling a tool. That is not allowed. Either call the tool now, or ask the member one short question. Do not describe results.';

/** Does a model REPLY say something happened (a ✓, or a done-word)? Only a tool call does anything. */
const CLAIM_WORDS = /\b(toegevoegd|afgevinkt|verwijderd|gewijzigd|aangepast|gezet op|added|removed|ticked|changed|done)\b/i;
export function claimsResult(text) {
  const s = String(text ?? '');
  return s.includes('✓') || CLAIM_WORDS.test(s);
}

/** What the model is told after a read it asked for. LLM-facing. */
const READ_THEN_ACT = 'Above is what you read for this message. If the member asked to CHANGE something (add, tick off, '
  + 'claim, complete, remove, edit), call that tool now, with the ids above. If they only asked to see it, call the same read again.';

/** Is this op a read (its verb lists or gets)? Unknown ops are not. */
function isRead(catalogue, opId) {
  const entry = catalogue?.opsById?.get?.(opId);
  const verb = entry?.op?.verb ?? entry?.verb;
  return verb === 'list' || verb === 'get' || verb === 'view';
}

/** A read's result as one context line for the model: its entries by id and words, or the result itself, short. */
function readLine(cmd, reply) {
  const p = reply && typeof reply === 'object' && 'payload' in reply ? reply.payload : reply;
  if (p == null) return null;
  const items = Array.isArray(p?.items) ? p.items : null;
  const body = items
    ? (items.length ? items.slice(0, 40).map((it) => `[${it?.id ?? '?'}] ${it?.label ?? it?.text ?? it?.title ?? ''}`).join('; ') : '(nothing)')
    : JSON.stringify(p).slice(0, 600);
  return `You read ${cmd.opId} ${JSON.stringify(cmd.args ?? {})}: ${body}`;
}

/** The bot is "addressed" when the turn @-tags it or opens with its name (phase-1: tag the bot). */
export function addressesBot(text, botName) {
  const t = String(text || '').toLowerCase();
  const n = String(botName || '').toLowerCase();
  if (/(^|\s)@(bot|assistent|assistant)\b/.test(t)) return true;
  if (!n) return false;
  return t.includes('@' + n) || t.startsWith(n + ' ') || t.startsWith(n + ',');
}

export function stripBotTag(text, botName) {
  const out = String(text)
    .replace(/(^|\s)@?(bot|assistent|assistant)\b[:,]?/ig, ' ')
    .replace(new RegExp('(^|\\s)@?' + escapeRe(botName) + '\\b[:,]?', 'ig'), ' ')
    .trim();
  return out || text;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
