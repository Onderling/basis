// v2 circle free-text → dispatch — the ONE platform-neutral turn engine for a typed turn in a circle
// (web↔mobile consolidation Phase 4: web's circleTurn is now a thin adapter over this; the
// gate→interpret→dispatch loop lives here ONCE):
//   1. an explicit /slash command       → dispatch it (unless `dispatchSlash:false` — the web shell
//                                          already routes slash upstream, so it defers via onUnhandled)
//   2. free text + the circle's LLM on + the bot ADDRESSED (@tag/name) → gate (rule → dispatch; skip →
//                                          unhandled) else interpret via the circle LLM → dispatch
//   3. otherwise                         → the injected sink (mobile: post to the kring; web: defer)
//
// Platform-neutral: the shell injects HOW to dispatch (slash string OR {opId,args}), the "unhandled"
// sink, the catalog, per-circle LLM providers, the policy (static OR a per-scope getter), and the
// NL→slash interpret. The household bot + the feedback v2 rewire reuse the same core — they differ only
// in the catalog/interpret.

import { resolveCircleLlm } from './llmPicker.js';
import { scopeCatalogToApps } from './circleCatalogScope.js';

/**
 * @param {object} a
 * @param {object|(()=>object)} [a.catalog]   the dispatch catalog (LLM tool list); static or a getter
 * @param {object|((ctx:object)=>object|Promise<object>)} [a.policy]  the circle policy; static OR a per-scope getter (web's `policyFor`)
 * @param {object|(()=>object)} [a.userDefault]   the member's personal default (only when policy is 'user'); static or a getter
 * @param {{local?:object,cloud?:object}|null} [a.llmProviders] host-supplied LlmClients
 * @param {(text:string, opts:{catalog,llm,context}) => Promise<{opId:string,args?:object}|null>} [a.interpret]  NL→slash
 * @param {(input:string|{opId:string,args:object}, ctx:object) => any} a.dispatch  run a typed slash STRING or an {opId,args} route
 * @param {(text:string, ctx:object) => any} [a.postToKring]  back-compat sink: posts a kring message (→ the default onUnhandled, reports 'kring')
 * @param {(text:string, ctx:object) => (string|Promise<string>)} [a.onUnhandled]  handle slash(when dispatchSlash:false)/skip/no-match/not-addressed; returns the `via` ('kring' | 'defer' | 'none' | …)
 * @param {boolean} [a.dispatchSlash=true]  when false, a /command is NOT dispatched here (left to onUnhandled — the web shell routes slash itself)
 * @param {object} [a.gate]   optional token gate ({ evaluate })
 * @param {string} [a.botName='assistant']
 */
export function createCircleDispatch({ catalog, policy, userDefault, llmProviders, interpret, dispatch, postToKring, onUnhandled, onNoMatch, dispatchSlash = true, gate, botName = 'assistant' }) {
  if (typeof dispatch !== 'function') {
    throw new Error('createCircleDispatch: dispatch is required');
  }
  const getCatalog     = typeof catalog === 'function' ? catalog : () => catalog;
  const getPolicy      = typeof policy === 'function' ? policy : () => policy;
  const getUserDefault = typeof userDefault === 'function' ? userDefault : () => userDefault;
  // The "everything-else" sink: an explicit onUnhandled, else a `postToKring` (back-compat → posts +
  // reports 'kring'), else a no-op reporting 'none'.
  const unhandled = typeof onUnhandled === 'function'
    ? onUnhandled
    : (typeof postToKring === 'function'
        ? async (text, ctx) => { await postToKring(text, ctx); return 'kring'; }
        : () => 'none');
  const sink = async (text, ctx) => (await unhandled(text, ctx)) ?? 'none';

  return {
    /** Route one typed turn. Returns `{ via: 'slash'|'rule'|'llm'|'kring'|'defer'|'none', cmd? }`. */
    async handle(text, ctx = {}) {
      const trimmed = String(text ?? '').trim();
      if (!trimmed) return { via: 'none' };

      // 1. explicit slash command → dispatch verbatim (unless the shell handles slash upstream).
      if (trimmed.startsWith('/')) {
        if (dispatchSlash) { await dispatch(trimmed, ctx); return { via: 'slash' }; }
        return { via: await sink(trimmed, ctx) };
      }

      // 2. free text + the circle's LLM enabled + the bot addressed → gate / interpret → dispatch.
      const circlePolicy = await getPolicy(ctx);
      const llm = resolveCircleLlm({ circlePolicy, userDefault: getUserDefault(), providers: llmProviders });
      if (llm && typeof interpret === 'function' && addressesBot(trimmed, botName)) {
        const stripped = stripBotTag(trimmed, botName);
        // Token gate (optional) — a cheap LOCAL pass before the (possibly remote) LLM: a rule routes a
        // command directly (no LLM); a skip treats the turn as normal chat (→ the sink); else interpret
        // with RAG context.
        let context;
        if (gate && typeof gate.evaluate === 'function') {
          const g = await gate.evaluate(stripped, ctx);
          if (g.via === 'rule' && g.command?.opId) {
            await dispatch({ opId: g.command.opId, args: g.command.args || {} }, ctx);
            return { via: 'rule', cmd: g.command };
          }
          if (g.via === 'skip') return { via: await sink(trimmed, ctx) };
          context = g.context;
        }
        // Part D — scope the LLM's tool list to the circle's apps (default: the circle apps;
        // `policy.apps` narrows further). Gate/dispatch unaffected.
        const scopedCatalog = scopeCatalogToApps(getCatalog(), circlePolicy?.apps);
        const cmd = await interpret(stripped, { catalog: scopedCatalog, llm, context });   // → {opId,args} | null
        if (cmd && cmd.opId) {
          await dispatch({ opId: cmd.opId, args: cmd.args && typeof cmd.args === 'object' ? cmd.args : {} }, ctx);
          return { via: 'llm', cmd };
        }
        // The LLM ran but mapped the message to NO tool. Don't go silent — the user addressed the bot and
        // deserves an answer. Let the shell reply ("I couldn't turn that into an action") via onNoMatch;
        // only fall through to the chat sink if the shell didn't wire one (back-compat).
        if (typeof onNoMatch === 'function') { await onNoMatch(stripped, ctx); return { via: 'llm-nomatch' }; }
        // the LLM couldn't map it to a command → fall through to the sink.
      }

      // 3. everything else → the injected sink.
      return { via: await sink(trimmed, ctx) };
    },
  };
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
