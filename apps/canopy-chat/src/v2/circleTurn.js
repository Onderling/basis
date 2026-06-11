// Web turn-interceptor for the v2 circle free-text surface — now a THIN ADAPTER over the shared
// `createCircleDispatch` (web↔mobile consolidation Phase 4: the gate→interpret→dispatch loop lives once
// in circleDispatch.js). The web shell (`main.js handleUserText`) already routes slash commands and
// falls through to its own "unknown command" handling, so this adapter:
//   - does NOT dispatch slash (`dispatchSlash:false`) — the shell handles it,
//   - DEFERS everything it doesn't take (`onUnhandled → 'defer'`) so the shell continues,
//   - returns a BOOLEAN (true = it dispatched a command and the shell should stop).
// Mobile uses the same engine directly, with a post-to-kring sink and slash dispatch on.

import { createCircleDispatch } from './circleDispatch.js';
import { interpretToCommand } from './interpretCommand.js';

/**
 * @param {object} a
 * @param {(scope:object) => ({llmTool?:'off'|'local'|'cloud'|'user'}|null|Promise<object>)} a.policyFor  the circle policy for a scope (may be async, e.g. load from a store)
 * @param {{local?:object,cloud?:object}|null} a.llmProviders   host-supplied LlmClients
 * @param {object|(() => object)} a.catalog                     the merged catalog (static or getter)
 * @param {(cmd:{opId:string,args:object}, scope:object) => any|Promise<any>} a.dispatchCommand  dispatch {opId,args} within the circle scope
 * @param {{mode?:'off'|'local'|'cloud'}|(() => {mode?:string})} [a.userDefault]  the member's personal default — used only when the circle policy is 'user'
 * @param {object} [a.gate]                                     optional token gate ({ evaluate })
 * @param {string} [a.botName]                                  the bot's address for @-tag detection
 * @param {Function} [a.interpret]                              override the NL→slash interpreter (tests)
 * @returns {(text:string, scope:object) => Promise<boolean>}
 */
export function createCircleTurn({ policyFor, llmProviders, catalog, dispatchCommand, userDefault, gate, botName = 'assistant', interpret = interpretToCommand }) {
  if (typeof dispatchCommand !== 'function') throw new Error('createCircleTurn: dispatchCommand required');
  const engine = createCircleDispatch({
    catalog,
    policy: typeof policyFor === 'function' ? policyFor : () => null,
    userDefault,
    llmProviders,
    interpret,
    dispatch: dispatchCommand,
    gate,
    botName,
    dispatchSlash: false,        // the web shell routes slash itself
    onUnhandled: () => 'defer',  // defer everything-else to the shell's existing pipeline
  });
  return async function handleCircleTurn(text, scope = {}) {
    const { via } = await engine.handle(text, scope);
    return via === 'rule' || via === 'llm';   // handled (shell stops) iff the turn dispatched a command
  };
}
