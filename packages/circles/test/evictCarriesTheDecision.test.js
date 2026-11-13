/**
 * A REMOVAL GOVERNANCE ENACTED CARRIES ITS DECISION ON THE EVICT STATEMENT: the proposal that decided it and the
 * settings version the enacting device held, so every member's roster fold can judge it by the circle's rule (the
 * receiver gate). An admin's removal without a decision carries neither (the gate judges it by the rule now).
 */
import { describe, it, expect } from 'vitest';
import { removeMember } from '../src/circleMembershipWriters.js';

function deps(spoken) {
  return {
    store: null, members: null, revokeKey: async () => ({ ok: true }), isCircleAdmin: (r) => r === 'admin',
    emitSpine: async (act) => { spoken.push(act); return { ok: true }; },
    circleRoleOf: async () => 'admin',
  };
}

describe('the evict statement carries the decision', () => {
  it('with a proposal and a settings version: both ride the payload', async () => {
    const spoken = [];
    await removeMember(deps(spoken), { a: { groupId: 'c1', memberWebid: 'm0', proposalId: 'p9', policyVersion: 3 }, from: 'a0' });
    const evict = spoken.find((s) => s.kind === 'evict');
    expect(evict.payload).toEqual({ proposalId: 'p9', policyVersion: 3 });
  });
  it('without a decision: no payload (judged by the rule now)', async () => {
    const spoken = [];
    await removeMember(deps(spoken), { a: { groupId: 'c1', memberWebid: 'm0' }, from: 'a0' });
    expect(spoken.find((s) => s.kind === 'evict').payload).toBeUndefined();
  });
});
