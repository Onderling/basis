/**
 * basis v2 — telling someone the circle became theirs.
 *
 * When the last admin walks out, the roster fold appoints a successor. That appointment is DERIVED, so
 * that every device reaches the same answer alone and offline, with nobody to ask — which is what makes
 * it correct. It also made it the one authority change in the system that nobody performs, and therefore
 * the one that happened in complete silence: no entry said it, and the person it happened to had no way
 * to find out except by noticing that a button they had never had suddenly worked.
 *
 * Frits' rule, and it is a good one: never change anything silently. So two things follow, and this
 * module decides both.
 *
 * ── 1. THE PERSON IT HAPPENED TO ─────────────────────────────────────────────────────────────────────
 * They are told, in the circle, at the moment they open it. Not a badge — a badge answers a question you
 * already knew to ask. Being handed a circle is not something you go looking for.
 *
 * They then SIGN for it — by TAKING an action on that notice, not by having it drawn at them. The device
 * signing on render would make "acknowledged" mean "a screen appeared", and the entire value of the
 * signature is that the circle can see the new custodian KNOWS. So the notice carries the act, and until
 * they take it the notice keeps saying so. For "a circle became yours" that is the right kind of
 * persistence.
 *
 * The statement is self-authored and carries the appointment's seed. The fold admits it only where it has
 * independently derived the same appointment (see `foldRoster`), so it grants nothing and cannot become a
 * second authority — it is a record, and it is also the exact thing that stops this notice repeating.
 * "Have I told them?" and "did they acknowledge it?" are the same question, answered from the log rather
 * than from device-local bookkeeping that a reinstall would lose.
 *
 * ── 2. EVERYONE ELSE GETS THE ROSTER, NOT A BUBBLE ───────────────────────────────────────────────────
 * The circle changed hands, which is not private — but the member list now says how each admin holds the
 * role, including the one nobody chose, so a member who wonders who to ask can see it. That is the right
 * weight: a person handed a circle needs telling; a person wondering who runs it needs somewhere to look.
 * An unprompted line for every member on every device would be noise, and would need device-local memory
 * of what it had already said, which a reinstall loses.
 *
 * ── WHAT THIS MODULE IS NOT ──────────────────────────────────────────────────────────────────────────
 * It has no opinion about rendering and no access to a store. It reads a folded roster and returns what
 * should be said, or null. The shells hold the primitive that puts a line in front of a person, and the
 * caller holds the memory of what it has already said. Same shape as the address-fallback offer next
 * door, and for the same reason: the decision is the part worth testing.
 */

/** The locale keys this module can ask for. Exported so a locale-coverage check can find them. */
export const CARETAKER_NOTICE_KEYS = Object.freeze({
  mine: 'circle.caretaker.now_yours',
});

const CARETAKER = 'caretaker:';
const refOf = (row) => (typeof row === 'string' ? row : (row?.webid ?? row?.addr ?? row?.ref ?? ''));

/**
 * The caretaker appointment a roster is carrying, if any.
 *
 * Reads ROSTER ROWS — `listGroupMembers`' shape, which is what both shells already hold — rather than a
 * raw fold result. The row is where `adminVia` and `adminViaAcknowledged` land, so there is one encoding
 * of "how does this person hold the role" for the badge, the notice and the peer allowlist alike.
 *
 * @param {Array<object>} members  roster rows
 * @returns {{ caretaker: string, seed: string, acknowledged: boolean }|null}
 */
export function currentCaretaker(members) {
  for (const row of Array.isArray(members) ? members : []) {
    const via = row?.adminVia;
    if (typeof via !== 'string' || !via.startsWith(CARETAKER)) continue;
    const seed = via.slice(CARETAKER.length);
    const ref = refOf(row);
    if (seed && ref) return { caretaker: ref, seed, acknowledged: row.adminViaAcknowledged === true };
  }
  return null;
}

/**
 * What, if anything, to say about who runs this circle.
 *
 * @param {object} a
 * @param {Array<object>} a.members    roster rows (`listGroupMembers`)
 * @param {string} a.myRef             this member's ref
 * @returns {{ key: string, seed: string, caretaker: string, acknowledge: boolean }|null}
 *   `acknowledge` is true when the notice should carry the act that signs for the appointment.
 */
export function caretakerNotice({ members, myRef } = {}) {
  const appointment = currentCaretaker(members);
  if (!appointment || typeof myRef !== 'string' || !myRef) return null;
  const { caretaker, seed, acknowledged } = appointment;

  // Only the person it happened to. Everyone else reads it off the member list.
  if (caretaker !== myRef) return null;
  // Already signed for it → already told. The log is the memory, so this survives a reinstall and is
  // the same answer on every one of this person's devices.
  if (acknowledged) return null;
  return { key: CARETAKER_NOTICE_KEYS.mine, seed, caretaker, acknowledge: true };
}

/**
 * The statement a caretaker signs for their own appointment. Kept here, beside the decision that calls
 * for it, so the payload shape and the fold's admission rule cannot drift apart — the fold admits
 * exactly `{ role: 'admin', caretakerFor: <seed> }` from a self-authored `role` statement.
 *
 * @param {object} a
 * @param {string} a.circleId
 * @param {string} a.myRef
 * @param {string} a.seed  the appointment's seed (the statement that emptied the admin set)
 * @returns {{ kind: string, circleId: string, subject: string, payload: object, actor: string }}
 */
export function caretakerAcknowledgement({ circleId, myRef, seed }) {
  return {
    kind: 'role',
    circleId,
    subject: myRef,
    payload: { role: 'admin', caretakerFor: seed },
    actor: myRef,
  };
}

export default caretakerNotice;
