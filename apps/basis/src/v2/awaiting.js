/**
 * MIJ: "WAT WACHT OP JOU" — what is waiting for the person, computed from reads the tabs already make, one chip per
 * kind and circle, each OPENING where the thing lives (nothing here acts):
 *   - `vote`   — an open proposal in a circle the person has not voted on (`openPolicyProposals`, the tile badge's read);
 *   - `rsvp`   — an appointment ahead in a circle, made by someone else, the person has not answered (its answers are
 *                projected from the answer items, so a missing key is "not answered");
 *   - `device` — a device offer waiting to be taken (an enrol offer stashed on this device);
 *   - `shared` — copies people shared privately with this person (the inbox once a door on My data).
 * Invites are not here: an invite is joined from its link or scan the moment it is opened, so none waits.
 */

/**
 * @param {object} a
 * @param {number} [a.now]
 * @param {Array<{id: string, name?: string}>} a.circles   the person's circles
 * @param {(circleId: string) => string|null} a.selfIn      the person's self in a circle (who "mine" is there)
 * @param {Record<string, Array<{votes?: Array<{voter: string}>}>>} [a.proposalsByCircle]
 * @param {Record<string, Array<{startsAt?: string, createdBy?: string, rsvp?: object, state?: string}>>} [a.eventsByCircle]
 * @param {boolean} [a.deviceOffer]
 * @param {number} [a.sharedWithMe]   how many copies were shared with this person (0 → no chip)
 * @returns {Array<{kind: string, circleId?: string, name?: string, count: number, open: object}>}
 */
/** The words each kind is said in (both shells paint `t(item.labelKey, {count, name})`). */
export const AWAITING_LABEL_KEYS = Object.freeze({
  vote: 'circle.mij.awaiting_vote',
  rsvp: 'circle.mij.awaiting_rsvp',
  device: 'circle.mij.awaiting_device',
  shared: 'circle.mij.awaiting_shared',
});

export function awaitingItems({ now = Date.now(), circles = [], selfIn = () => null, proposalsByCircle = {}, eventsByCircle = {}, deviceOffer = false, sharedWithMe = 0 } = {}) {
  const out = [];
  const named = (c) => c.name ?? '';
  for (const c of circles) {
    const me = selfIn(c.id);
    const open = (proposalsByCircle[c.id] ?? []).filter((p) => !(p?.votes ?? []).some((v) => v?.voter && v.voter === me));
    if (open.length) out.push({ kind: 'vote', circleId: c.id, name: named(c), count: open.length, open: { kind: 'open-proposals', circleId: c.id } });
  }
  for (const c of circles) {
    const me = selfIn(c.id);
    const unanswered = (eventsByCircle[c.id] ?? []).filter((e) => e && e.state !== 'cancelled'
      && Date.parse(e.startsAt ?? '') > now && e.createdBy !== me && !(me && e.rsvp && e.rsvp[me]));
    if (unanswered.length) out.push({ kind: 'rsvp', circleId: c.id, name: named(c), count: unanswered.length, open: { kind: 'open-circle', circleId: c.id } });
  }
  if (deviceOffer) out.push({ kind: 'device', count: 1, open: { kind: 'open-mydata' } });
  if (Number(sharedWithMe) > 0) out.push({ kind: 'shared', count: Number(sharedWithMe), open: { kind: 'open-shared-with-me' } });
  return out.map((it) => ({ ...it, labelKey: AWAITING_LABEL_KEYS[it.kind] }));
}
