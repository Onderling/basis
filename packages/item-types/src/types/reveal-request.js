/**
 * `reveal-request` type — bilateral real-name reveal handshake.
 * Pinboard's two-sided reveal flow; not commercial-anything (no
 * schema.org analogue).
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const REVEAL_REQUEST_SCHEMA = {
  iri:         `${NAMESPACE}RevealRequest`,
  description: 'A bilateral real-name reveal handshake.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'requester', 'target'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'reveal-request' },
    requester:   { type: 'string', minLength: 1 },
    target:      { type: 'string', minLength: 1 },
    threadId:    { type: 'string' },
    status:      {
      type: 'string',
      enum: ['pending', 'accepted', 'declined', 'expired'],
    },
    respondedAt: { type: 'string', format: 'date-time' },
  },
};
