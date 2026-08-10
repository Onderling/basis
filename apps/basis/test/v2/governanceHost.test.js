/**
 * Governance host factory (Phase 4 §5, L4) — the shared wiring both shells use.
 *
 * Locks: each action maps to the REAL op (removeMember → stoop removeMember, changeRule →
 * editGroupRules); the admin gate (Decision A) lets an admin device enact but not a member
 * device; and view() projects the current fold for the shell.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCircleGovernance } from '../../src/v2/governanceHost.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const members = [
  { ref: 'admin0', role: 'admin' },
  { ref: 'm0', role: 'member' }, { ref: 'm1', role: 'member' }, { ref: 'm2', role: 'member' },
];

/** Build a host over an in-memory log; `localActorRef` decides this device's enact authority. */
function host({ governance = {}, localActorRef = 'admin0' } = {}) {
  const events = [];
  const policy = normalizeCirclePolicy({ governance });
  const callSkill = vi.fn(async () => ({ ok: true }));
  let n = 0;
  const gov = makeCircleGovernance({
    callSkill,
    // The host consumes the rail's VERIFIED state; these pure-fake tests supply it directly (no dispute
    // machinery here — the rail's own suite covers fork-proofs).
    readGovernanceState: async () => ({ events, disputed: new Set() }),
    appendGovernanceEvent: async (_c, e) => { events.push(e); },
    getPolicy: async () => policy,
    getMembers: async () => members,
    localActorRef,
    newProposalId: () => `p${(n += 1)}`,
    now: () => 0,
  });
  return { gov, callSkill, events };
}

describe('makeCircleGovernance — enact routing', () => {
  it('an admin removing a member (any-admin) calls stoop removeMember with the target', async () => {
    const { gov, callSkill } = host({ governance: { removeMember: 'any-admin' } });
    const r = await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2@id', actor: { ref: 'admin0' } });
    expect(r.status).toBe(DECISION_STATUS.APPROVED);
    expect(callSkill).toHaveBeenCalledWith('stoop', 'removeMember', { groupId: 'c1', memberWebid: 'm2@id', policy: 'graceful' });
  });

  it('changeRule enacts via editGroupRules with the rules subject', async () => {
    const { gov, callSkill } = host({ governance: { changeRule: 'any-admin' } });
    const rules = { name: 'Huisregels', quietHours: '22-07' };
    await gov.propose({ circleId: 'c1', action: 'changeRule', subject: rules, actor: { ref: 'admin0' } });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'editGroupRules', { groupId: 'c1', rules });
  });
});

describe('the admin enact gate (Decision A)', () => {
  it('a member device does not enact an approved vote; an admin device does', async () => {
    // member device
    const asMember = host({ governance: { removeMember: 'member-vote' }, localActorRef: 'm0' });
    const { proposalId } = await asMember.gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2@id', actor: { ref: 'admin0' }, deadline: 100 });
    await asMember.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });
    const tip = await asMember.gov.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });  // 3/4 → approved
    expect(tip).toMatchObject({ status: DECISION_STATUS.APPROVED, awaitingEnactment: true });
    expect(asMember.callSkill).not.toHaveBeenCalledWith('stoop', 'removeMember', expect.anything());

    // admin device, same votes → enacts
    const asAdmin = host({ governance: { removeMember: 'member-vote' }, localActorRef: 'admin0' });
    const p2 = await asAdmin.gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2@id', actor: { ref: 'admin0' }, deadline: 100 });
    await asAdmin.gov.vote({ circleId: 'c1', proposalId: p2.proposalId, voter: 'm0', choice: 'yes' });
    const tip2 = await asAdmin.gov.vote({ circleId: 'c1', proposalId: p2.proposalId, voter: 'm1', choice: 'yes' });
    expect(tip2).toMatchObject({ status: DECISION_STATUS.APPROVED, enacted: true });
    expect(asAdmin.callSkill).toHaveBeenCalledWith('stoop', 'removeMember', { groupId: 'c1', memberWebid: 'm2@id', policy: 'graceful' });
  });
});

describe('view()', () => {
  it('projects the current open proposals for the shell', async () => {
    const { gov } = host({ governance: { removeMember: 'member-vote' } });
    await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2@id', actor: { ref: 'admin0' }, deadline: 100 });
    const v = await gov.view('c1', { labelForSubject: (s) => `lid ${s}` });
    expect(v.hasOpen).toBe(true);
    expect(v.open[0]).toMatchObject({ action: 'removeMember', subjectLabel: 'lid m2@id', decisionClass: 'member-vote' });
  });
});
