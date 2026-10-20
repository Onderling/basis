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
 * The appointment's `rsvp` is a READ projection over these items (`withAnswers`); nothing writes it. An item counts
 * only when it speaks for its writer: the person in its id, its `by` and the self that wrote it (`updatedBy`) are one
 * — a member cannot answer for another (the rail checks that the author is a member, not whom the item speaks for).
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

/** The answers to each appointment, `{ <eventId>: { <person>: response } }`, from a store's rsvp items. */
export function answersByEvent(rsvpItems) {
  const out = {};
  for (const it of Array.isArray(rsvpItems) ? rsvpItems : []) {
    if (!speaksForItsWriter(it)) continue;
    (out[it.event] ??= {})[it.by] = it.response;
  }
  return out;
}

/** The appointments with their `rsvp` projected from the answer items (the map is absent where nobody answered). */
export function withAnswers(events, rsvpItems) {
  const by = answersByEvent(rsvpItems);
  return (Array.isArray(events) ? events : []).map((e) => {
    const { rsvp: _stale, ...rest } = e ?? {};
    return by[e?.id] ? { ...rest, rsvp: by[e.id] } : rest;
  });
}
