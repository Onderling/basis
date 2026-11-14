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

/**
 * How many times the read a key-file change builds on may disagree with itself before the change is given up (scope:device,
 * kind:internal). A pod can serve a TORN read: a GET that overlaps another writer's PUT returns the old body under the
 * new ETag (measured on a Community Solid Server, 2026-11-15), and a change built on it passes its If-Match and writes
 * the other writer's change away. So the read under a change is trusted only when two consecutive GETs agree on the
 * ETag AND the body (the key store's `readForWrite`).
 */
export const KEY_READ_AGREE_ATTEMPTS = param({ key: 'podClient.keyReadAgreeAttempts', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 });

/** Thrown when the read under a key-file change never agreed with itself: the change was NOT written (never built on one read). */
export class KeyReadTornError extends Error {
  constructor(attempts) {
    super(`the group-key resource never read the same twice (${attempts} attempts) — the change was not written`);
    this.name = 'KeyReadTornError';
    this.code = 'KEY_READ_TORN';
    this.attempts = attempts;
  }
}

/** The read a key-file change builds on: the store's trusted read when it has one (a pod), else its plain read. */
export const readKeyForWrite = (keyStore) => (typeof keyStore.readForWrite === 'function' ? keyStore.readForWrite() : keyStore.read());

/** This writer's own change is in `stored`: the recipients it added are there (same version; a later version is a
 *  rotation another writer decided, which this writer does not undo). */
function holdsOwnChange(stored, next, cur) {
  if (!stored || !next) return true;
  if ((stored.version ?? null) !== (next.version ?? null)) return true;
  const had = new Set(cur?.recipients ?? []);
  const have = new Set(stored.recipients ?? []);
  return (next.recipients ?? []).filter((r) => !had.has(r)).every((r) => have.has(r));
}

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
      const cur = await readKeyForWrite(keyStore);
      const next = await compute(cur);
      if (!next) return { written: null, base: cur };
      if (typeof keyStore.writeIfUnchanged !== 'function') { await keyStore.write(next); return { written: next, base: cur }; }
      if (await keyStore.writeIfUnchanged(next, cur) !== false) {
        // VERIFY: this writer's own change is in the file. If it is not, it is said and applied again through this loop
        // (compute decides again on the newest base: a member removed meanwhile is not put back)
        if (typeof keyStore.readForWrite !== 'function' || holdsOwnChange(await keyStore.readForWrite(), next, cur)) return { written: next, base: cur };
        if (typeof console !== 'undefined') console.warn('[key-write] this writer\'s change was not in the key file after its write: applying it again');
      }
    }
    throw new KeyWriteContendedError(attempts);
  });
}
