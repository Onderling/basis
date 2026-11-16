/**
 * `message-request` type — a first message from someone this self did not choose, held until the person decides:
 * accept (the held card becomes a contact, the held turns move into the new thread), ignore (kept, marked, still
 * acceptable) or block. One row per (self, sender identity), in that self's own-devices scope (sealed, carried between
 * the person's own devices), never in the contact book and never in a circle: a request is not a contact with a flag,
 * so no reader of the book can mistake a stranger for someone chosen.
 *
 * `card` is the sender's card as it arrived (the `onderling-contact://` payload, decoded and checked, NOT added). A
 * request may have NONE: a member of one of the self's circles the person never answered, after the person stopped
 * letting circle members write first (their card rode only their first message; `memberName` is the name they have in
 * the circle), or a turn held after the door's hold refused it (nothing at that door is dropped silently; the turn's
 * `refused` names the reason). Accepting a request without a card puts no row in the book.
 * `turns` is a set of `{ messageId, text, ts }` that only grows between devices (the `set-union` resolution, keyed by
 * the message id, timed by the SENDER's time so it is the same on every device); `turnsBefore` is its floor, raised to
 * keep the bound, merged by its maximum, so every device drops the same oldest turns.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

/** The states a held request can be in: open (new to the person) or ignored (kept, no longer new). */
export const MESSAGE_REQUEST_STATES = Object.freeze(['open', 'ignored']);

export const MESSAGE_REQUEST_SCHEMA = {
  iri:         `${NAMESPACE}MessageRequest`,
  description: 'A first message from someone I did not choose, waiting for my answer (own-devices scope only).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'from', 'turns', 'state'],
  properties: {
    ...BASE_PROPERTIES,
    type:  { const: 'message-request' },
    from:  { type: 'string', minLength: 1 },
    card:  { type: 'string', minLength: 1 },
    memberName: { type: 'string', minLength: 1 },
    turns: {
      type:  'array',
      items: {
        type:       'object',
        required:   ['messageId', 'text', 'ts'],
        properties: { messageId: { type: 'string', minLength: 1 }, text: { type: 'string' }, ts: { type: 'number' }, refused: { type: 'string', minLength: 1 } },
      },
    },
    turnsBefore: { type: 'number' },
    firstAt:     { type: 'number' },
    lastAt:      { type: 'number' },
    state:       { enum: [...MESSAGE_REQUEST_STATES] },
  },
};

/** The type's set-union declaration: the held turns, keyed by message id, timed by the sender, pruned by the floor. */
export const MESSAGE_REQUEST_SET_UNION = Object.freeze({ field: 'turns', key: 'messageId', at: 'ts', floor: 'turnsBefore' });
