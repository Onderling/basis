import { describe, it, expect, vi } from 'vitest';
import { membershipBindingVerifier } from '../../src/v2/membershipRail.js';

describe('the membership binding verifier reads the trail once per burst', () => {
  it('five verifications within the window cost one spineless roster read; the next burst reads again', async () => {
    // A fold verifies every statement of a circle; re-reading the trail per statement had the roster
    // read running continuously on the phone and taps being dropped. Same answer, one read per burst.
    const callSkill = vi.fn(async () => ({ members: [{ webid: 'w:ada', circleAddress: 'addr:ada' }] }));
    const verify = membershipBindingVerifier(callSkill, { memoMs: 100 });
    const results = await Promise.all(Array.from({ length: 5 }, () => verify({ author: 'addr:ada', ref: 'w:ada', circleId: 'k1', kind: 'join' })));
    expect(results).toEqual([true, true, true, true, true]);
    expect(callSkill).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 130));
    expect(await verify({ author: 'addr:bob', ref: 'w:bob', circleId: 'k1', kind: 'join' })).toBe(false);
    expect(callSkill, 'after the window a fresh row can be seen').toHaveBeenCalledTimes(2);
  });
  it('a failed read is not memoised', async () => {
    const callSkill = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ members: [] });
    const verify = membershipBindingVerifier(callSkill, { memoMs: 100 });
    expect(await verify({ author: 'a', ref: 'r', circleId: 'k1' })).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(await verify({ author: 'a', ref: 'r', circleId: 'k1' })).toBe(false);
    expect(callSkill).toHaveBeenCalledTimes(2);
  });
});
