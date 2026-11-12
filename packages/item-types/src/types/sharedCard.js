/**
 * `shared-card` type — one link a person handed out ("Share my contact"): a random token on the card that link shows,
 * recorded on the persona shared as, in that persona's own-devices scope (sealed, carried between the person's own
 * devices), never in a circle and never in the contact book. The FIRST turn that carries the token is let on as if the
 * person had chosen its sender (a thread, the card held, no book row until the person answers); any later turn is
 * decided as any stranger's. A link is used once, valid for a while, withdrawn by deleting the row.
 *
 * "Used once" holds across the person's devices: two devices may each let on a different first opener before they
 * hear of each other, so the use is a CLAIM that resolves first-wins (the item store's claim channel, declared for
 * this type in `CANONICAL_CLAIMS`). The claim fold speaks the task claim vocabulary, so the use is written in it:
 * `assignee` is WHO used the link (the opener's identity), `claimedAt` is WHEN (this device's time of letting them on).
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const SHARED_CARD_SCHEMA = {
  iri:         `${NAMESPACE}SharedCard`,
  description: 'A contact link I handed out, used by its first opener only (own-devices scope only).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'self', 'token', 'mintedAt', 'expiresAt'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'shared-card' },
    self:      { type: 'string', minLength: 1 },
    token:     { type: 'string', minLength: 16 },
    mintedAt:  { type: 'number' },
    expiresAt: { type: 'number' },
    // the use, as a first-wins claim (the claim channel's field names): who used it and when
    assignee:  { type: 'string', minLength: 1 },
    claimedAt: { type: 'number' },
    // the card the first opener's turn carried (`onderling-contact://…`): names their thread until the person answers.
    // Plain content beside the claim, so a reader takes its name only when the card names the claim's winner.
    card:      { type: 'string', minLength: 1 },
  },
};
