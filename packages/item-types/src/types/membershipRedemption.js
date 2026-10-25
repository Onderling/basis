/**
 * `membership-redemption` type — a row of a circle's ROSTER TRAIL: one member's admission to the circle (who redeemed,
 * the role, their keys) and the addresses they are proven to answer at there.
 *
 * It lives in the circle's own store, but it is not carried like the store's other rows: a roster row's addresses
 * enter the roster only PROVEN, it is patched in place by the announce path, and it reaches other devices by the
 * carriers that keep that trust — the join statements on the membership lane, the announces, the roster seed between
 * a person's own devices. The task lane neither publishes, serves nor applies it (`@onderling/circles` rosterTrail).
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const MEMBERSHIP_REDEMPTION_SCHEMA = {
  iri:         `${NAMESPACE}MembershipRedemption`,
  description: "A row of a circle's roster trail: a member's admission and the addresses they are proven to answer at.",
  type:        'object',
  required:    [...BASE_REQUIRED, 'source'],
  properties: {
    ...BASE_PROPERTIES,
    type:   { const: 'membership-redemption' },
    text:   { type: 'string' },
    source: {
      type:       'object',
      required:   ['groupId'],
      properties: {
        groupId:    { type: 'string', minLength: 1 },
        redeemedBy: { type: 'string' },
        role:       { type: 'string' },
      },
    },
  },
};
