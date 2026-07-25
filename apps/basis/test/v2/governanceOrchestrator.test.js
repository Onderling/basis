/**
 * Governance orchestrator (Phase 4 §5, L4) — routing an action through its class.
 *
 * An in-memory event log + a spy enactor + a fixed roster stand in for the injected seams.
 * Locks: any-admin enacts immediately (once, via the real op); member-vote opens a proposal
 * and enacts exactly when the full-membership threshold is met; a no-majority rejects; the
 * admin past-deadline override forces a pending vote; a non-admin can't override.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeGovernanceOrchestrator } from '../../src/v2/governanceOrchestrator.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const members5 = [
  { ref: 'admin0', role: 'admin' },
  { ref: 'm0', role: 'member' }, { ref: 'm1', role: 'member' },
  { ref: 'm2', role: 'member' }, { ref: 'm3', role: 'member' },
];

/** Build an orchestrator over an in-memory log; `now`, the policy, and enact-authority are injectable. */
function harness({ governance = {}, clock = { t: 0 }, canEnact = () => true } = {}) {
  const events = [];
  const policy = normalizeCirclePolicy({ governance });
  const enact = vi.fn(async () => ({ ok: true }));
  let n = 0;
  const orch = makeGovernanceOrchestrator({
    appendEvent: async (_circleId, e) => { events.push(e); },
    enact,
    getContext: async () => ({ policy, members: members5, events }),
    newProposalId: () => `p${(n += 1)}`,
    now: () => clock.t,
    canEnact,
  });
  return { orch, events, enact, clock };
}

describe('any-admin — immediate enactment', () => {
  it('an admin removing a member enacts once, via the real op, and records propose+resolve', async () => {
    const { orch, enact, events } = harness({ governance: { removeMember: 'any-admin' } });
    const r = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'admin0' } });
    expect(r).toMatchObject({ ok: true, status: DECISION_STATUS.APPROVED, enacted: true });
    expect(enact).toHaveBeenCalledTimes(1);
    expect(enact).toHaveBeenCalledWith('c1', 'removeMember', 'm3');
    expect(events.map((e) => e.event)).toEqual(['propose', 'resolve']);
  });

  it('a non-admin proposing an any-admin action is refused and enacts nothing', async () => {
    const { orch, enact } = harness({ governance: { removeMember: 'any-admin' } });
    const r = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'm0' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-admin');
    expect(enact).not.toHaveBeenCalled();
  });
});

describe('member-vote — proposal, tally, enact on threshold', () => {
  it('opening a vote pends (only the proposer has voted) and enacts nothing yet', async () => {
    const { orch, enact } = harness({ governance: { removeMember: 'member-vote' } });
    const r = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'admin0' }, deadline: 100 });
    expect(r.status).toBe(DECISION_STATUS.PENDING);       // 1 of 5, needs 3
    expect(r.tally).toEqual({ yes: 1, no: 0, need: 3, of: 5 });
    expect(enact).not.toHaveBeenCalled();
  });

  it('enacts exactly when the full-membership majority is reached', async () => {
    const { orch, enact } = harness({ governance: { removeMember: 'member-vote' } });
    const { proposalId } = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'admin0' }, deadline: 100 });
    expect((await orch.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' })).status).toBe(DECISION_STATUS.PENDING); // 2/5
    const third = await orch.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });                                  // 3/5
    expect(third).toMatchObject({ status: DECISION_STATUS.APPROVED, enacted: true });
    expect(enact).toHaveBeenCalledTimes(1);
    expect(enact).toHaveBeenCalledWith('c1', 'removeMember', 'm3');
  });

  it('Decision A: a non-admin device does NOT enact an approved vote — it awaits the admin', async () => {
    // canEnact false = this device is not an admin/caretaker.
    const { orch, enact, events } = harness({ governance: { removeMember: 'member-vote' }, canEnact: () => false });
    const { proposalId } = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'admin0' }, deadline: 100 });
    await orch.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });
    const tipping = await orch.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });  // 3/5 → approved
    expect(tipping).toMatchObject({ status: DECISION_STATUS.APPROVED, awaitingEnactment: true });
    expect(enact).not.toHaveBeenCalled();                      // the op is left to an admin device
    expect(events.some((e) => e.event === 'resolve')).toBe(false); // and it isn't closed here
  });

  it('a no-majority rejects and closes the proposal without enacting', async () => {
    const { orch, enact } = harness({ governance: { removeMember: 'member-vote' } });
    const { proposalId } = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'admin0' }, deadline: 100 });
    await orch.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'no' });
    await orch.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'no' });
    const r = await orch.vote({ circleId: 'c1', proposalId, voter: 'm2', choice: 'no' });   // 3 no of 5 → yes-majority impossible
    expect(r.status).toBe(DECISION_STATUS.REJECTED);
    expect(enact).not.toHaveBeenCalled();
  });
});

describe('admin override — the past-deadline valve', () => {
  it('an admin forces a stuck vote past its deadline; a member cannot', async () => {
    const clock = { t: 10 };
    const { orch, enact } = harness({ governance: { removeMember: 'member-vote' }, clock });
    const { proposalId } = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'admin0' }, deadline: 100 });
    // still short of a majority, and now past the deadline
    clock.t = 200;
    const memberTry = await orch.override({ circleId: 'c1', proposalId, actor: { ref: 'm0' } });
    expect(memberTry.ok).toBe(false);
    expect(enact).not.toHaveBeenCalled();
    const adminForce = await orch.override({ circleId: 'c1', proposalId, actor: { ref: 'admin0' } });
    expect(adminForce).toMatchObject({ ok: true, status: DECISION_STATUS.APPROVED, reason: 'admin-override' });
    expect(enact).toHaveBeenCalledWith('c1', 'removeMember', 'm3');
  });

  it('override before the deadline is refused', async () => {
    const clock = { t: 10 };
    const { orch, enact } = harness({ governance: { removeMember: 'member-vote' }, clock });
    const { proposalId } = await orch.propose({ circleId: 'c1', action: 'removeMember', subject: 'm3', actor: { ref: 'admin0' }, deadline: 100 });
    const r = await orch.override({ circleId: 'c1', proposalId, actor: { ref: 'admin0' } });  // still t=10 < 100
    expect(r.ok).toBe(false);
    expect(enact).not.toHaveBeenCalled();
  });
});
