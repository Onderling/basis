/**
 * The audience check's key → people map, from the circle's redemption rows: the primary address with its proof and the
 * proof-carrying pairs an announcement added (a member's other devices); former members' rows count; a pair without its
 * proof, or another circle's row, is not read.
 */
import { describe, it, expect } from 'vitest';
import { keyHoldersFromRedemptions } from '../src/skills/index.js';

const img = (a) => `img(${a})`;
const row = (groupId, redeemedBy, circleAddress, circleAddressProof, circleAddresses = []) => ({ source: { groupId, redeemedBy, circleAddress, circleAddressProof, circleAddresses } });

describe('keyHoldersFromRedemptions', () => {
  it('maps every verified address of a member, devices included, and nothing unverified', () => {
    const m = keyHoldersFromRedemptions([
      row('g', 'bea', 'bea-phone', 'p1', [{ address: 'bea-box', proof: 'p2' }, { address: 'bea-unproven' }]),
      row('g', 'cas', 'cas-phone', null),             // a primary with no proof: not read
      row('other', 'dan', 'dan-phone', 'p3'),          // another circle
    ], 'g', img);
    expect([...m.get(img('bea-phone'))]).toEqual(['bea']);
    expect([...m.get(img('bea-box'))], 'a device of the member').toEqual(['bea']);
    expect(m.has(img('bea-unproven'))).toBe(false);
    expect(m.has(img('cas-phone'))).toBe(false);
    expect(m.has(img('dan-phone'))).toBe(false);
  });

  it('one address on two rows maps to both people', () => {
    const m = keyHoldersFromRedemptions([row('g', 'bea', 'shared', 'p'), row('g', 'cas', 'shared', 'q')], 'g', img);
    expect([...m.get(img('shared'))].sort()).toEqual(['bea', 'cas']);
  });
});
