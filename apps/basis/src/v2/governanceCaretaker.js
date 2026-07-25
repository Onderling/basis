/**
 * basis v2 — last-admin caretaker appointment (Connectivity Phase 4 §5, L4).
 *
 * If the LAST admin of a circle departs (self-removal or vote-out), the circle would be
 * left with no one who can rotate keys, approve joins, or remove members — frozen. So a
 * member is promoted immediately (not a fresh vote: a vote needs quorum and leaves an
 * adminless gap). The pick must be **deterministic**, never a locally-rolled random —
 * independent dice would diverge and the fix would itself be a fork. Every replica folds
 * the same departure event and computes the SAME order from it, so the appointment is
 * agreed with no coordination, even across a partition.
 *
 * The order is a verifiable pseudo-random shuffle seeded by the departing admin's final
 * event hash: `sha256(departingHash | address)`, ascending. The per-circle address is
 * cryptographically derived (not vanity-chosen), so the pick can't be gamed by anyone
 * grinding an address, and join-timing doesn't help. `unreachable` members (offline or
 * declined) are skipped → next-in-line, so a dead first pick doesn't re-strand the circle.
 * The appointment is a CARETAKER — a member-vote circle can reassign admin afterward.
 *
 * See docs/decisions.md (2026-07-25).
 */
import { hashHex } from '@onderling/core';

/** The deterministic seed key for one candidate: sha256(departingHash | address), hex. */
function seedKey(departingHash, address) {
  return hashHex(`${String(departingHash)}|${address}`);
}

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
  const pool = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && typeof c.ref === 'string' && typeof c.address === 'string' && c.address);
  return pool
    .map((c) => ({ c, key: seedKey(departingHash, c.address) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : (a.c.address < b.c.address ? -1 : 1)))
    .map(({ c }) => c);
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
