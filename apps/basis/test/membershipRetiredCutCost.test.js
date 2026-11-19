/**
 * The membership lane's binding check asks for this self's ceremony commitment only when it needs one (ledger L619, a
 * phone start profile). `ownRetiredCut` — the "an address this self retired still binds what it signed before" rule —
 * computed the commitment for EVERY statement it was handed, though it is only compared against an `address-revoke`
 * by that author, which almost no statement has. Now the stored revokes are looked at first, and the commitment is
 * asked for only when one names the author.
 */
import { describe, it, expect } from 'vitest';
import { membershipBindingVerifier } from '../src/v2/membershipRail.js';

const callSkill = async () => ({ members: [] });

describe('the retired-address rule asks for the commitment only when a revoke could apply', () => {
  it('N statements by authors with no revoke: no commitment asked for', async () => {
    let asked = 0;
    const verify = membershipBindingVerifier(callSkill, {
      ownCeremonyCommitmentFor: () => { asked += 1; return 'c0ffee'; },
      chainFor: () => () => null,
      storedFor: () => [{ body: { kind: 'member-props', subject: 'x' } }],
    });
    const N = 25;
    for (let i = 0; i < N; i += 1) {
      expect(await verify({ author: `addr-${i}`, ref: `ref-${i}`, circleId: 'c-1', kind: 'member-props', payload: {}, subject: `ref-${i}`, hash: `h${i}` })).toBe(false);
    }
    expect(asked).toBe(0);
  });

  it('a stored revoke naming the author still asks for it (the rule is unchanged)', async () => {
    let asked = 0;
    const verify = membershipBindingVerifier(callSkill, {
      ownCeremonyCommitmentFor: () => { asked += 1; return 'c0ffee'; },
      chainFor: () => () => null,
      storedFor: () => [{ body: { kind: 'address-revoke', subject: 'addr-1', payload: { upTo: 'h0', authorRef: 'ref-1', reveal: null } } }],
    });
    expect(await verify({ author: 'addr-1', ref: 'ref-1', circleId: 'c-1', kind: 'member-props', payload: {}, subject: 'ref-1', hash: 'h1' })).toBe(false);
    expect(asked).toBe(1);
  });
});
