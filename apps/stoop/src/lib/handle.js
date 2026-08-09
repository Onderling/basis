/**
 * Handle validation — pure, no I/O.
 *
 * Stoop V1 (Phase 6) handle rules:
 *   - lowercase a–z, digits 0–9, `-` (hyphen) and `_` (underscore) only
 *   - 3 to 32 chars
 *   - no leading `@` (the UI prepends `@` when rendering)
 *   - no spaces
 *
 * Apps render handles as `@<handle>` in lists; the storage form is
 * unprefixed.  Strip a leading `@` before validating so users who type
 * `@anne-23` get a friendly normalisation rather than a hard error.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — handle length bounds (scope:device, kind:internal).
const MIN_LEN = param({ key: 'stoop.handleMinLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
const MAX_LEN = param({ key: 'stoop.handleMaxLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 32 });
const HANDLE_RE = /^[a-z0-9_-]+$/;

/**
 * @param {string} input  user-entered handle (raw)
 * @returns {{ ok: true, handle: string } | { ok: false, reason: string }}
 *   On success returns the normalised (lowercased, leading-`@`-stripped)
 *   handle. On failure returns a machine-readable reason code that apps
 *   can map to localised copy.
 */
export function validateHandle(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'not-a-string' };
  // Friendly normalisation: strip leading `@`, lowercase.
  let h = input.trim();
  if (h.startsWith('@')) h = h.slice(1);
  h = h.toLowerCase();

  if (h.length < MIN_LEN) return { ok: false, reason: 'too-short' };
  if (h.length > MAX_LEN) return { ok: false, reason: 'too-long' };
  if (/\s/.test(h))       return { ok: false, reason: 'contains-whitespace' };
  if (!HANDLE_RE.test(h)) return { ok: false, reason: 'invalid-chars' };

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
 * Per-circle handle-uniqueness check (Phase 4 Wave B — the pinned rule: no
 * duplicate handles within a single circle). Pure; the caller supplies the set
 * of handles already held in THIS circle.
 *
 * A member re-claiming their OWN current handle is NOT a collision — rows whose
 * `webid` equals `claimantWebid` are skipped. Comparison is case-folded via
 * `foldHandle`, matching `validateHandle`'s normalisation.
 *
 * @param {object} o
 * @param {string} o.candidate            the handle being claimed (raw or normalised)
 * @param {string} o.claimantWebid        the webid claiming it (its own row never collides)
 * @param {Array<{webid: string, handle: *}>} [o.taken]  handles already held in the circle
 * @returns {string|null}  the webid of the colliding member, or null when free.
 */
export function findHandleCollision({ candidate, claimantWebid, taken = [] }) {
  const want = foldHandle(candidate);
  if (!want) return null;
  for (const entry of taken) {
    if (!entry || entry.webid === claimantWebid) continue;
    if (foldHandle(entry.handle) === want) return entry.webid;
  }
  return null;
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
  pattern: HANDLE_RE.source,
});
