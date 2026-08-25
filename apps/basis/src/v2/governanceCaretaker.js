/**
 * basis v2 — the last-admin caretaker, and the one thing this file still owns.
 *
 * If the LAST admin of a circle departs, the circle would be left with nobody who can rotate keys,
 * approve joins or remove members — frozen. So a member is appointed immediately, rather than by a
 * fresh vote: a vote needs quorum and leaves an adminless gap in the meantime. The pick must be
 * DETERMINISTIC, never locally-rolled — independent dice diverge, and the fix would itself be a fork.
 * Every replica folds the same departure and computes the same order from it, so the appointment is
 * agreed with no coordination, even across a partition. (docs/decisions.md, 2026-07-25.)
 *
 * ── WHERE THE APPOINTMENT ACTUALLY HAPPENS ───────────────────────────────────────────────────────
 * In the roster fold, in the kernel — not here. That is the only place it can be, because the
 * appointment has to hold for a device that is offline, alone, and replaying the log: anything that
 * needed an app to run would leave such a device disagreeing about who is in charge.
 *
 * This header used to describe the order as `sha256(departingHash | address)` over per-circle
 * ADDRESSES, and this module used to compute it that way while the fold keyed on member REFS. Two
 * orders for a decision whose entire purpose is that it cannot fork. There is exactly one now, in
 * `@onderling/core`, and `caretakerOrder` below delegates to it.
 *
 * ── SO WHAT IS LEFT HERE ─────────────────────────────────────────────────────────────────────────
 * One refinement the fold cannot make: SKIPPING an unreachable candidate. Reachability is a live
 * fact about the world right now, and the log does not carry it — two devices asking "is she online?"
 * can honestly disagree, which is precisely the disagreement the deterministic order exists to
 * prevent. So the fold appoints the first-ranked candidate unconditionally (the floor: a circle always
 * has an admin), and `appointCaretaker` here is the refinement for a caller that DOES hold a
 * reachability fact and is willing to own the risk of acting on it.
 *
 * Worth knowing before you rely on it: nothing in production calls it. The appointment people actually
 * get is the fold's.
 */
import { caretakerOrder as coreCaretakerOrder } from '@onderling/core';



/**
 * True when a caretaker MUST be appointed: after the departure the roster still has
 * members but no admin among them. (An empty circle needs no caretaker.)
 * @param {Array<{ref?:string, role?:string}>} membersAfter  the roster AFTER the departure
 */
export function needsCaretaker(membersAfter) {
  const roster = Array.isArray(membersAfter) ? membersAfter : [];
  return roster.length > 0 && !roster.some((m) => m && m.role === 'admin');
}

/**
 * The full deterministic succession order over the candidates, seeded by `departingHash`.
 * A stable permutation of the (valid) candidates — every replica computes it identically.
 * @param {{candidates?: Array<{ref:string, address:string}>, departingHash?: string}} a
 * @returns {Array<{ref:string, address:string}>}
 */
export function caretakerOrder({ candidates = [], departingHash = '' } = {}) {
  // DELEGATES to the kernel's one implementation. This used to compute its own order, keyed on the
  // per-circle ADDRESS, while the fold — which is what actually appoints — keys on the member REF.
  // Two orders for one "can never itself fork" decision is the fork it was written to prevent, so
  // there is now exactly one, in core, and this adds only the `unreachable` refinement below (a live
  // fact the log does not carry, which is why that half cannot live in the fold).
  const pool = (Array.isArray(candidates) ? candidates : []).filter((c) => c && typeof c.ref === 'string');
  const byRef = new Map(pool.map((c) => [c.ref, c]));
  return coreCaretakerOrder([...byRef.keys()], departingHash).map((ref) => byRef.get(ref));
}

/**
 * Deterministically appoint the caretaker admin from the remaining members. `unreachable`
 * (refs and/or addresses that declined or are offline) are skipped in succession order →
 * next-in-line. Returns the chosen `{ref, address}`, or null when there are no candidates.
 * If EVERY candidate is unreachable it still returns the first-ranked (deterministic) so
 * the circle isn't left re-stranded.
 * @param {{candidates?: Array<{ref:string, address:string}>, departingHash?: string,
 *          unreachable?: Set<string>|Array<string>|null}} a
 */
export function appointCaretaker({ candidates = [], departingHash = '', unreachable = null } = {}) {
  const order = caretakerOrder({ candidates, departingHash });
  if (order.length === 0) return null;
  const skip = unreachable instanceof Set ? unreachable : new Set(Array.isArray(unreachable) ? unreachable : []);
  const pick = order.find((c) => !skip.has(c.ref) && !skip.has(c.address));
  return pick ?? order[0];
}
