// keyResourceWrite.js — ONE way to change a group-key resource: read the stored resource, compute this writer's
// own change ON THAT BASE, write it only if the resource is still the one that was read, and recompute on the
// newest base when another writer got there first.
//
// Every writer of a key resource (the circle control agent's bootstrap, join, device enrolment, device revoke,
// member removal; the canonical share's grant and revoke) goes through here. Two guarantees:
//   • in-process: one promise chain per key store, so no two writers in this process compute from the same base;
//   • across devices: when the store can compare-and-swap (`writeIfUnchanged(candidate, cur)` → false when the
//     stored resource is no longer `cur`), a lost race recomputes on what the winner wrote, so the winner's change
//     is kept and this writer's change is applied on top of it — never the file as this writer remembered it.
// A store without compare-and-swap (an in-memory test store) falls back to a plain write: same-process writers are
// still ordered by the chain.

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/** Bounded optimistic-concurrency attempts for one key-resource change (scope:device, kind:internal). */
export const MAX_KEY_WRITE_ATTEMPTS = param({ key: 'podClient.grantAttempts', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 });

const chains = new WeakMap();

/**
 * One promise chain per KEY STORE: every caller writing the same group-key resource in this process takes the
 * critical section in turn. Errors are contained, so one failed change cannot wedge the queue.
 * @param {object} keyStore
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
export function keyStoreSerializer(keyStore) {
  return (fn) => {
    const prev = chains.get(keyStore) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(keyStore, run.then(() => undefined, () => undefined));
    return run;
  };
}

/** Thrown when every attempt lost a race: the change was NOT written. The caller reports it; nothing is dropped quietly. */
export class KeyWriteContendedError extends Error {
  constructor(attempts) {
    super(`the group-key resource kept changing under this writer (${attempts} attempts) — the change was not written`);
    this.name = 'KeyWriteContendedError';
    this.code = 'KEY_WRITE_CONTENDED';
    this.attempts = attempts;
  }
}

/**
 * Apply one change to a key resource: `compute(cur)` returns the next resource built on `cur` (the stored one),
 * or `null` when there is nothing to change on that base. Serialised in-process; compare-and-swap across devices.
 *
 * @param {{ read: Function, write: Function, writeIfUnchanged?: Function }} keyStore
 * @param {(cur: object|null) => (object|null|Promise<object|null>)} compute
 * @param {{ attempts?: number }} [opts]
 * @returns {Promise<{ written: object|null, base: object|null }>}  `written` null = nothing to change.
 */
export function changeKeyResource(keyStore, compute, { attempts = MAX_KEY_WRITE_ATTEMPTS } = {}) {
  return keyStoreSerializer(keyStore)(async () => {
    for (let i = 0; i < attempts; i += 1) {
      const cur = await keyStore.read();
      const next = await compute(cur);
      if (!next) return { written: null, base: cur };
      if (typeof keyStore.writeIfUnchanged !== 'function') { await keyStore.write(next); return { written: next, base: cur }; }
      if (await keyStore.writeIfUnchanged(next, cur) !== false) return { written: next, base: cur };
    }
    throw new KeyWriteContendedError(attempts);
  });
}
