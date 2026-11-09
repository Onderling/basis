/**
 * The name a person uses in a circle — pure, no I/O.
 *
 * The name is for people: any letters, spaces and capitals, 1 to 40 characters after trimming, no control
 * characters. It used to be an identifier (lowercase, digits, `-`/`_`, 3–32, painted `@name`); that rule went
 * when the walk showed people could not use their own name ("Tester B") in a circle (Frits, 2026-11-06). The
 * join wizard's `isValidName` applies the same rule before the name is sent; a test pins the two together.
 *
 * Kept as typed (no lowercasing). A leading `@` is still stripped: it was the old display prefix, and someone
 * who types it means the name after it. Uniqueness compares case-folded (`foldHandle`).
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — name length bounds (scope:device, kind:internal).
const MIN_LEN = param({ key: 'pinboard.handleMinLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1 });
const MAX_LEN = param({ key: 'pinboard.handleMaxLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 40 });
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * @param {string} input  the name as typed
 * @returns {{ ok: true, handle: string } | { ok: false, reason: string }}
 *   On success the name, trimmed and without a leading `@`. On failure a machine-readable reason code that
 *   apps can map to localised copy.
 */
export function validateHandle(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'not-a-string' };
  let h = input.trim();
  if (h.startsWith('@')) h = h.slice(1).trim();

  if (h.length < MIN_LEN)  return { ok: false, reason: 'too-short' };
  if (h.length > MAX_LEN)  return { ok: false, reason: 'too-long' };
  if (CONTROL_RE.test(h))  return { ok: false, reason: 'invalid-chars' };

  return { ok: true, handle: h };
}

/**
 * Case-fold a handle for collision comparison.  Matches `validateHandle`'s
 * normalisation EXACTLY (trim → strip leading `@` → lowercase) so the
 * uniqueness check treats `Jan`, `jan` and `@jan` as the same handle. Returns
 * '' for anything non-stringy (a value that can never collide).
 *
 * @param {*} input
 * @returns {string}
 */
export function foldHandle(input) {
  if (typeof input !== 'string') return '';
  let h = input.trim();
  if (h.startsWith('@')) h = h.slice(1);
  return h.toLowerCase();
}

/**
 * Serialise a handle CLAIM for one circle, so the uniqueness rule survives concurrency.
 *
 * Found 2026-07-26 (story 2.1). Every claim path is read-then-write —
 * `collectCircleHandles()` … `await` … `store.addItems()` — with awaits in between. Two joiners redeeming
 * the same invite and both picking `@jan` therefore BOTH read a roster without `jan` and BOTH wrote: three
 * concurrent claims produced three members named `jan`. The rule is mandatory precisely because there is no
 * disambiguation afterwards (`NOTE-identity-and-linkability.md`), so a duplicate is unresolvable — two
 * people simply answer to one name.
 *
 * A promise chain per `(circleId, handle)` — not per circle — so unrelated joins still run concurrently and
 * a busy circle does not serialise its whole join flow. Keyed by the OWNING object (the store), so two
 * circles hosted by one admin, and two admins in one test process, keep separate chains.
 *
 * SCOPE, deliberately stated: this makes the claim atomic within ONE admin process, which is where the
 * roster lives — the admin/host is the authority that owns it. It does NOT coordinate two DIFFERENT admins
 * of the same circle admitting joiners while partitioned from each other; that is the L3/L4 governance
 * problem (a duplicate would surface as a divergence to reconcile), not something a local lock can solve.
 *
 * @param {object} owner        the roster-owning object (the item store) — identifies the chain
 * @param {string} circleId
 * @param {string} handle       the claimed handle (case-folded internally, so `Jan`/`jan` share a chain)
 * @param {() => Promise<T>} fn the read-check-write critical section
 * @returns {Promise<T>}
 * @template T
 */
const _claimChains = new WeakMap();   // owner → Map<`${circleId}\n${foldedHandle}`, Promise>
export function withHandleClaim(owner, circleId, handle, fn) {
  if (!owner || typeof fn !== 'function') return Promise.resolve().then(() => fn?.());
  if (!_claimChains.has(owner)) _claimChains.set(owner, new Map());
  const chains = _claimChains.get(owner);
  const key = `${circleId ?? ''}\n${foldHandle(handle) ?? ''}`;
  const prev = chains.get(key) ?? Promise.resolve();
  // The chain must never break on a rejection, or one failed claim would wedge every later one.
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next.catch(() => {}));
  return next;
}

/** Constants exported for UI form-validation hints + localisation. */
export const HANDLE_RULES = Object.freeze({
  minLen: MIN_LEN,
  maxLen: MAX_LEN,
});
