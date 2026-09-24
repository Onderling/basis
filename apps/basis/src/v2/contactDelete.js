/**
 * DELETING A CONTACT (L114, Frits 2026-09-24: Fable's option (i)) — a relationship act, not a row drop.
 *
 * The pair circle's id is derived from the two webids (`pairCircleIdFor`), so there is no "second relationship"
 * to start later: whatever the two of you have is that circle. Deleting therefore PAUSES the relationship on this
 * side, visibly and honestly:
 *
 *   1. the row is hidden and marked deleted (`deletedAt`) — out of Contacten on every device of the person (the
 *      hidden mark's own carry);
 *   2. this side LEAVES the pair circle — a `leave` on its membership lane: the route and its keys stop, the other
 *      side's roster loses you, and the person's other devices follow the leave (siblings-follow, v0.1.18);
 *   3. the thread stays on disk; nothing is erased.
 *
 * If they write again, the pair roster brings the circle back — the SAME circle, re-joined — and the row returns
 * like a hidden contact does, with "je had dit contact verwijderd" above the turn, because `deletedAt` is on record.
 * The confirm sheet before step 1 is the undo; there is no silent path back.
 */
import { leaveCircleLocally } from './circleMembershipHygiene.js';

/**
 * @param {object} a
 * @param {object} a.agent                    the running agent (the leave unbinds through it)
 * @param {Function} [a.callSkill]            the shell's `(app, op, args)` through the waist (so the hide fans); defaults to the agent's
 * @param {string} a.contactWebid
 * @param {string|null} a.pairCircleId       the pair roster's id for this contact; null = no pair circle (hide only)
 * @param {() => any} [a.unregister]          the shell's transport de-registration for the left circle
 * @returns {Promise<{ok: boolean, left: boolean, error?: string}>}
 */
export async function deleteContact({ agent, callSkill = null, contactWebid, pairCircleId = null, unregister = null } = {}) {
  const call = typeof callSkill === 'function' ? callSkill : (app, op, args) => agent.callSkill(app, op, args);
  if ((!agent && typeof callSkill !== 'function') || typeof contactWebid !== 'string' || !contactWebid) return { ok: false, left: false, error: 'missing-args' };
  const hid = await call('stoop', 'setContactHidden', { webid: contactWebid, hidden: true, deleted: true }).catch((e) => ({ error: e?.message ?? String(e) }));
  if (hid?.error) return { ok: false, left: false, error: hid.error };
  let left = false;
  if (pairCircleId) {
    const r = await leaveCircleLocally({ agent, callSkill: call, circleId: pairCircleId, unregister });
    left = r.ok === true;
  }
  return { ok: true, left };
}

/**
 * Which words the marker above a returning turn says: "je had dit contact verwijderd" for a return after a deletion,
 * "je had dit contact verborgen" otherwise. The turn records THAT it was a return (`returned`, fixed where it first
 * landed); the row records WHEN the contact was deleted, so a return that came before a later deletion keeps its
 * own words. A turn without a time counts as after.
 * @param {{returned?: boolean, ts?: number}} turn
 * @param {number|null} deletedAt   the contact row's `deletedAt`
 * @returns {string|null}           the locale key, or null when the turn is not a return
 */
export function returnedMarkerKey(turn, deletedAt) {
  if (turn?.returned !== true) return null;
  const deleted = Number.isFinite(deletedAt) && (!Number.isFinite(turn?.ts) || turn.ts >= deletedAt);
  return deleted ? 'circle.contacts.returned_deleted_marker' : 'circle.contacts.returned_marker';
}
