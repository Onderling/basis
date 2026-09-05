/**
 * A retired address keeps its PAST statements verifiable.
 *
 * Bindings re-verify against the live roster on every read, so a revoked device's earlier key events,
 * tasks and votes used to drop out of the folds the moment its address was retired. Now a roster row keeps
 * each retired address with the POSITION of its revocation on this device's log, and a statement that
 * landed here before that position still binds — while anything after, backdated or not, is refused.
 * The coordinate is the receiver's own log order: deterministic, no wall clock, nothing a writer can stamp.
 */
import { describe, it, expect } from 'vitest';
import { addressBindsOnRow, rosterBindingVerifier } from '../../src/v2/membershipRail.js';
import { keyBindingVerifier } from '../../src/v2/keyRail.js';

const row = {
  webid: 'webid:anna', role: 'admin', circleAddress: 'new-phone', circleAddresses: ['new-phone'],
  retiredAddresses: [{ address: 'old-phone', atSeq: 40 }],
};

describe('addressBindsOnRow — revocation cuts the future, not the past', () => {
  it('live addresses bind at any position; a retired one only before its retirement landed', () => {
    expect(addressBindsOnRow(row, 'new-phone', 999)).toBe(true);
    expect(addressBindsOnRow(row, 'old-phone', 12)).toBe(true);     // landed before the revocation (seq 40)
    expect(addressBindsOnRow(row, 'old-phone', 40)).toBe(false);    // the revocation itself and after
    expect(addressBindsOnRow(row, 'old-phone', 41)).toBe(false);
    expect(addressBindsOnRow(row, 'old-phone', null)).toBe(false);  // a fresh arrival (ingest) has no position: refused
    expect(addressBindsOnRow(row, 'stranger', 1)).toBe(false);
  });
  it('a retirement whose position is unknown retires everything (deny-favouring)', () => {
    const r = { ...row, retiredAddresses: [{ address: 'old-phone', atSeq: null }] };
    expect(addressBindsOnRow(r, 'old-phone', 1)).toBe(false);
  });
  it('the content-lane and key-lane verifiers apply it', async () => {
    const callSkill = async () => ({ members: [row] });
    const content = rosterBindingVerifier(callSkill);
    expect(await content({ author: 'old-phone', ref: 'webid:anna', circleId: 'g', atSeq: 12 })).toBe(true);
    expect(await content({ author: 'old-phone', ref: 'webid:anna', circleId: 'g', atSeq: 50 })).toBe(false);
    expect(await content({ author: 'old-phone', ref: 'webid:anna', circleId: 'g' })).toBe(false);
    const key = keyBindingVerifier(callSkill);
    const establish = { kind: 'key-establish', payload: { event: { version: 1 } } };
    expect(await key({ author: 'old-phone', ref: 'webid:anna', circleId: 'g', ...establish, atSeq: 12 }), 'the chain the old admin device established stays').toBe(true);
    expect(await key({ author: 'old-phone', ref: 'webid:anna', circleId: 'g', ...establish, atSeq: 50 })).toBe(false);
  });
});
