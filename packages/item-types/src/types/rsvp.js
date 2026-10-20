/**
 * `rsvp` type — one person's answer to one appointment, as its own item: `{ event, by, response, at }`, with the
 * deterministic id `rsvp:<eventId>:<person>`.
 *
 * An answer is a fact owned by ONE person, so it is not a field on the appointment: a field on the appointment is
 * overwritten by any later whole-item write of it (a move, a re-share) that had not seen the answer. As its own item,
 * written only by the person whose id it carries, the store's per-item last-write-wins IS "that person's latest
 * answer". The appointment's `rsvp` map is a read projection over these items (and only items whose writer is the
 * person they speak for count). Never shown in a merged view: it is read through its appointment only.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const RSVP_SCHEMA = {
  iri:         `${NAMESPACE}Rsvp`,
  description: "One person's answer to one appointment (accepted · declined · tentative); read through its event only.",
  type:        'object',
  required:    [...BASE_REQUIRED, 'event', 'by', 'response'],
  properties: {
    ...BASE_PROPERTIES,
    type:     { const: 'rsvp' },
    event:    { type: 'string', minLength: 1 },
    by:       { type: 'string', minLength: 1 },
    response: { enum: ['accepted', 'declined', 'tentative'] },
    at:       { type: 'number' },
  },
};
