/**
 * AN ANSWER TO AN APPOINTMENT IS ITS OWN ITEM — `{ type: 'rsvp', id: 'rsvp:<eventId>:<person>', event, by, response, at }`
 * in the appointment's circle, written as the answering self.
 *
 * An answer was a field on the appointment (`event.rsvp[<person>]`), and the store merges whole items by their clock:
 * any later write of the appointment that had not seen the answer (a move or a re-share by its maker, a copy's second
 * write) carried the map without it and won — on every replica. One item per (appointment, person), written only by
 * that person, makes the store's own per-item last-write-wins the rule "that person's latest answer" — no fold, no
 * second merge semantics.
 *
 * The appointment's `rsvp` is a READ projection over these items (`withAnswers`); nothing writes it.
 *
 * WHO an answer is from is SIGNED, not stated: on the content lane an item's `updatedBy` is payload (the rail's
 * signature authenticates the carrier, not the facts inside the snapshot), so any member could fan an answer naming
 * someone else. An answer carries `sig` by the answering self's CIRCLE identity (the address key the rails sign with)
 * over (`rsvp` · event · by · response · at), and `signer` = that address. Where it is read, it counts only when the
 * signature verifies AND the roster binds `by` to that address (the circle link) — or `by` is a door person of a
 * function profile (the household bot's `telegram:…`) and the signer is the vouching profile. The rule is injected
 * (`counts`) by whoever holds the roster; without one (a store no one else writes: a person's own calendar), the
 * local shape is all there is: the person in the id, `by` and `updatedBy` are one.
 */

export const RSVP_TYPE = 'rsvp';
export const RSVP_RESPONSES = Object.freeze(['accepted', 'declined', 'tentative']);

/** The one id a person's answer to an appointment has. */
export function rsvpItemId(eventId, person) { return `rsvp:${eventId}:${person}`; }

/** The answer item to put, as `person` (the self that writes it). */
export function rsvpItem({ eventId, person, response, at = Date.now() }) {
  if (!RSVP_RESPONSES.includes(response)) throw new Error(`rsvp: bad response "${response}"`);
  return { type: RSVP_TYPE, id: rsvpItemId(eventId, person), event: eventId, by: person, response, at };
}

/** Whether an rsvp item speaks for the self that wrote it (else it is ignored, never shown as anyone's answer). */
export function speaksForItsWriter(it) {
  return it?.type === RSVP_TYPE && typeof it.by === 'string' && !!it.by && it.updatedBy === it.by
    && it.id === rsvpItemId(it.event, it.by) && RSVP_RESPONSES.includes(it.response);
}

/** The exact words an answer's signature covers. */
export function answerStatement(it) {
  return ['rsvp', it?.event ?? '', it?.by ?? '', it?.response ?? '', it?.at ?? ''].join('\u0000');
}

/** An answer item, signed by `identity` (`{ pubKey, sign(message) → bytes }`: the answering self's circle identity). */
export function signedRsvpItem(identity, facts, encode) {
  const it = rsvpItem(facts);
  return { ...it, signer: identity.pubKey, sig: encode(identity.sign(answerStatement(it))) };
}

/** Whether an answer's shape is whole (its id is its event and person, its response one of the three). */
function wellFormed(it) {
  return it?.type === RSVP_TYPE && typeof it.by === 'string' && !!it.by && it.id === rsvpItemId(it.event, it.by) && RSVP_RESPONSES.includes(it.response);
}

/** The answers to each appointment, `{ <eventId>: { <person>: response } }`, from a store's rsvp items; `counts` (the
 *  roster's rule, see the header) decides which answers stand — absent, the local shape (`speaksForItsWriter`). */
export function answersByEvent(rsvpItems, counts = null) {
  const out = {};
  for (const it of Array.isArray(rsvpItems) ? rsvpItems : []) {
    if (!wellFormed(it)) continue;
    if (typeof counts === 'function' ? !counts(it) : !speaksForItsWriter(it)) continue;
    (out[it.event] ??= {})[it.by] = it.response;
  }
  return out;
}

/** The appointments with their `rsvp` projected from the answer items (the map is absent where nobody answered). */
export function withAnswers(events, rsvpItems, counts = null) {
  const by = answersByEvent(rsvpItems, counts);
  return (Array.isArray(events) ? events : []).map((e) => {
    const { rsvp: _stale, ...rest } = e ?? {};
    return by[e?.id] ? { ...rest, rsvp: by[e.id] } : rest;
  });
}

/**
 * The roster's rule for which answers stand in a circle (the `counts` above): the signature verifies against its
 * `signer`, and either the roster binds `by` to that address — the row's own or a further device's (a member answering
 * as themselves, from any of their devices) — or `by` is no
 * member and the signer is one of the `vouchers` (the circle identity of a function profile answering for its door
 * people). A member's device signing for someone else counts for nothing.
 * @param {{ rows: Array<{webid?: string, circleAddress?: string, circleAddresses?: Array<{address: string, proof: string}>}>, verify: (message: string, sig: string, pubKey: string) => boolean, vouchers?: string[] }} a
 */
export function rosterAnswerRule({ rows = [], verify, vouchers = [] } = {}) {
  // a member's addresses: the row's own and each further device's, kept with its proof (pinboard's `rowHolds` rule —
  // a person answers from any of their devices, each with its own circle address)
  const addressesOf = new Map();
  const members = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (typeof r?.webid !== 'string' || !r.webid) continue;
    members.add(r.webid);
    const held = new Set();
    if (typeof r.circleAddress === 'string' && r.circleAddress) held.add(r.circleAddress);
    for (const p of Array.isArray(r.circleAddresses) ? r.circleAddresses : []) if (typeof p?.address === 'string' && typeof p?.proof === 'string' && p.proof) held.add(p.address);
    addressesOf.set(r.webid, held);
  }
  const vouch = new Set((vouchers ?? []).filter(Boolean));
  return (it) => {
    if (typeof it?.sig !== 'string' || typeof it?.signer !== 'string' || typeof verify !== 'function') return false;
    let ok = false;
    try { ok = verify(answerStatement(it), it.sig, it.signer) === true; } catch { ok = false; }
    if (!ok) return false;
    if (members.has(it.by)) return addressesOf.get(it.by)?.has(it.signer) === true;
    return vouch.has(it.signer);
  };
}
