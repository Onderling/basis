// Clarifying dispatch — wraps command dispatch with the clarification turn, and holds the per-scope
// "pending question" state so a follow-up pick re-enters cleanly.
//
// Flow: run(command) → clarifyCommandTargets →
//   ready      → dispatchReady (the shell's normal dispatch)
//   clarify    → ask(question) + remember the pending command for this scope (circle/thread)
//   unresolved → askMissing (or report); clears pending
// A later pick(candidateId) binds the chosen id and RE-RUNS run() — which may resolve, or clarify a
// further id-param (turn-by-turn, one question at a time). Platform-neutral: the shell injects how to
// look candidates up (circle-scoped), how to dispatch a ready command, and how to ask.

import { clarifyCommandTargets } from './clarifyTargets.js';

/**
 * @param {object} a
 * @param {() => object} a.catalog                                     getter for the current catalog
 * @param {(listOp:string, query:string, scope:object)=>any[]|Promise<any[]>} a.lookup  circle-scoped candidate search
 * @param {(cmd:{opId:string,args:object}, scope:object)=>any|Promise<any>} a.dispatchReady  dispatch a fully-resolved command
 * @param {(q:{opId:string,param:string,query:string,candidates:Array<{id,label,hint?}>}, scope:object)=>any|Promise<any>} a.ask  present the "which one?" question
 * @param {(m:{opId:string,param:string,query:string}, scope:object)=>any|Promise<any>} [a.askMissing]  required target not found
 */
export function createClarifyingDispatch({ catalog, lookup, dispatchReady, ask, askMissing }) {
  if (typeof dispatchReady !== 'function' || typeof ask !== 'function') {
    throw new Error('createClarifyingDispatch: dispatchReady + ask are required');
  }
  const getCatalog = typeof catalog === 'function' ? catalog : () => catalog;
  const pending = new Map();                                  // scopeKey → {opId, args, param}
  const keyOf = (scope) => (scope && (scope.id ?? scope)) ?? '_';

  async function run(command, scope = {}) {
    const r = await clarifyCommandTargets(command, { catalog: getCatalog(), lookup, scope });
    if (r.kind === 'ready') {
      pending.delete(keyOf(scope));
      await dispatchReady({ opId: r.opId, args: r.args }, scope);
      return r;
    }
    if (r.kind === 'clarify') {
      pending.set(keyOf(scope), { opId: r.opId, args: r.args, param: r.param });
      await ask({ opId: r.opId, param: r.param, query: r.query, candidates: r.candidates }, scope);
      return r;
    }
    // unresolved
    pending.delete(keyOf(scope));
    if (typeof askMissing === 'function') await askMissing({ opId: r.opId, param: r.param, query: r.query }, scope);
    return r;
  }

  async function pick(candidateId, scope = {}) {
    const p = pending.get(keyOf(scope));
    if (!p) return { kind: 'no-pending' };
    pending.delete(keyOf(scope));
    return run({ opId: p.opId, args: { ...p.args, [p.param]: candidateId } }, scope);
  }

  return { run, pick, hasPending: (scope) => pending.has(keyOf(scope)) };
}
