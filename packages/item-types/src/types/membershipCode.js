/**
 * `membership-code` type — a circle's invite code, the ADMIN's secret. It lives only in the admin's own-devices scope
 * (sealed, carried between that self's own devices, so any of them can rotate it or check a redemption) — never in a
 * circle's store, never on a roster, never on a rail in the clear: a trail row names the code only by its id.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const MEMBERSHIP_CODE_SCHEMA = {
  iri:         `${NAMESPACE}MembershipCode`,
  description: "A circle's invite code: the admin's own (own-devices scope only).",
  type:        'object',
  required:    [...BASE_REQUIRED, 'source'],
  properties: {
    ...BASE_PROPERTIES,
    type:   { const: 'membership-code' },
    source: {
      type:     'object',
      required: ['groupId', 'code'],
      properties: {
        groupId:   { type: 'string', minLength: 1 },
        code:      { type: 'string', minLength: 1 },
        issuedAt:  { type: 'number' },
        expiresAt: { type: 'number' },
      },
    },
  },
};
