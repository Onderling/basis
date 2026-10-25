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

/** A proven address: the address and the signature by the key behind it over its link to the circle. */
const ADDRESS = { type: 'object', properties: { address: { type: 'string' }, proof: { type: 'string' } } };

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
        groupId:    { type: 'string', minLength: 1, description: 'the circle this admission is to' },
        redeemedBy: { type: 'string', description: 'the member admitted (their webid)' },
        role:       { type: 'string', description: 'their role in the circle' },
        codeId:     { type: ['string', 'null'], description: 'the invite code it was redeemed with, by id (never the code itself)' },
        redeemedAt: { type: 'number' },
        expiresAt:  { type: ['number', 'null'], description: 'when the invite it was redeemed with expired' },
        channel:    { type: 'string', description: "how the admission was made ('peer', 'intro', or a local redeem when absent)" },
        confirmedBy: { type: ['string', 'null'], description: 'the admin who admitted them' },
        signingPublicKey: { type: 'string', description: "the member's signing key (fan-out routing)" },
        sealingPublicKey: { type: 'string', description: 'the key the group key is wrapped to for them' },
        circleAddress:      { type: 'string', description: "the member's per-circle address, recorded only when proven" },
        circleAddressProof: { type: 'string', description: 'the signature by the key behind circleAddress over its link to this circle' },
        circleAddresses:    { type: 'array', description: 'further proven addresses the member answers at in this circle', items: ADDRESS },
        ceremonyCommitment: { description: "the member's declared ceremony commitment, with its circle-key signature" },
        personaProperties:  { type: 'object', description: 'what the member released to this circle' },
        announcedAt:        { type: 'number', description: 'when an announce last patched this row in place' },
        confirmedByCircleAddress:      { type: 'string', description: "the admitting admin's per-circle address, proven" },
        confirmedByCircleAddressProof: { type: 'string' },
        confirmedByCircleAddresses:    { type: 'array', items: ADDRESS },
        confirmedByCeremonyCommitment: { description: "the admitting admin's ceremony commitment" },
      },
    },
  },
};
