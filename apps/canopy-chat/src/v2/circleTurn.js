// Web turn-interceptor for the v2 circle free-text surface.
//
// The web shell (`main.js handleUserText`) ALREADY routes slash commands and, for non-slash text,
// falls through to its "unknown command" handling. This interceptor slots in at that seam and adds
// ONLY the missing branch: when the circle's `llmTool` is on AND the bot is addressed, interpret the
// free text as a command (`interpretCommand`) and dispatch it — SCOPED to the active circle, because
// the host's `dispatchCommand` runs it against the current circle thread. Returns `true` when it
// dispatched (the shell stops), `false` to fall through to the shell's normal handling.
//
// Mobile (`CircleLauncherScreen`) instead uses `createCircleDispatch` — a fresh turn-handler with a
// real "post to the kring" — because there the kring input has no pre-existing slash routing to defer
// to. Both share the same core (`selectLlmClient` + `addressesBot` + `interpretToCommand`); they
// differ only in what "everything else" means (web: the shell's existing pipeline; mobile: a kring post).

import { resolveCircleLlm } from './llmPicker.js';
import { addressesBot, stripBotTag } from './circleDispatch.js';
import { interpretToCommand } from './interpretCommand.js';

/**
 * @param {object} a
 * @param {(scope:object) => ({llmTool?:'off'|'local'|'cloud'|'user'}|null|Promise<object>)} a.policyFor  the circle policy for a scope (thread); may be async (e.g. load from a store)
 * @param {{local?:object,cloud?:object}|null} a.llmProviders   host-supplied LlmClients
 * @param {() => object} a.catalog                              getter for the CURRENT merged catalog
 * @param {(cmd:{opId:string,args:object}, scope:object) => any|Promise<any>} a.dispatchCommand  dispatch {opId,args} within the circle scope
 * @param {{mode?:'off'|'local'|'cloud'}|(() => {mode?:string})} [a.userDefault]  the member's personal default — used only when the circle policy is 'user'
 * @param {string} [a.botName]                                  the bot's address for @-tag detection
 * @param {Function} [a.interpret]                              override the NL→slash interpreter (tests)
 * @returns {(text:string, scope:object) => Promise<boolean>}
 */
export function createCircleTurn({ policyFor, llmProviders, catalog, dispatchCommand, userDefault, gate, botName = 'assistant', interpret = interpretToCommand }) {
  if (typeof dispatchCommand !== 'function') throw new Error('createCircleTurn: dispatchCommand required');
  const policy = typeof policyFor === 'function' ? policyFor : () => null;
  const getCatalog = typeof catalog === 'function' ? catalog : () => catalog;
  const getUserDefault = typeof userDefault === 'function' ? userDefault : () => userDefault;

  return async function handleCircleTurn(text, scope = {}) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed || trimmed.startsWith('/')) return false;          // slashes are the shell's job
    const circlePolicy = await policy(scope);                       // policyFor may load the circle's policy async
    const llm = resolveCircleLlm({ circlePolicy, userDefault: getUserDefault(), providers: llmProviders });
    if (!llm || !addressesBot(trimmed, botName)) return false;      // off, or not addressed → fall through
    const stripped = stripBotTag(trimmed, botName);
    // Token gate (optional) — a cheap LOCAL pass before the (possibly remote) LLM: a rule can route a
    // command directly or skip the LLM entirely. 'llm' carries RAG context into interpret.
    let context;
    if (gate && typeof gate.evaluate === 'function') {
      const g = await gate.evaluate(stripped, scope);
      if (g.via === 'rule' && g.command?.opId) {
        await dispatchCommand({ opId: g.command.opId, args: g.command.args || {} }, scope);
        return true;
      }
      if (g.via === 'skip') return false;
      context = g.context;
    }
    const cmd = await interpret(stripped, { catalog: getCatalog(), llm, context });
    if (!cmd || !cmd.opId) return false;                            // no command fits → fall through
    await dispatchCommand({ opId: cmd.opId, args: cmd.args && typeof cmd.args === 'object' ? cmd.args : {} }, scope);
    return true;
  };
}
