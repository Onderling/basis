/**
 * "N MEMBERS JOINED SINCE THIS PROPOSAL WAS MADE" — a SHOWN hint on an open decision, never a gate (Frits 2026-11-15:
 * no vote freeze for the alpha; a vote counts the roster as it is now, and the screen says how many of those joined after
 * the proposal). Counted from the join statements this device holds whose signed time (`payload.at`, set by the joining
 * or admitting device) is after the proposal's own signed time; a join's time is self-declared, which is why this only
 * informs. A join without a time (made before joins carried one) is not counted; someone who joined and left since is not
 * a member and is not counted.
 */
import { describe, it, expect, vi } from 'vitest';
import { joinsSince, buildGovernanceView } from '../../src/v2/governanceView.js';
import { makeCircleGovernance } from '../../src/v2/governanceHost.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';

const join = (subject, at) => ({ kind: 'join', subject, ...(at == null ? {} : { payload: { at } }) });

describe('joinsSince', () => {
  it('counts the members whose signed join is after the proposal, once each', () => {
    const bodies = [join('a', 100), join('b', 900), join('c', 1500), join('d', 2000), join('d', 2100), join('e', null)];
    const members = ['a', 'b', 'c', 'd', 'e'].map((ref) => ({ ref }));
    expect(joinsSince(bodies, 1000, members)).toBe(2);   // c and d (d once); e has no time; a and b before
  });

  it('someone who joined after the proposal and has left since is not counted', () => {
    expect(joinsSince([join('c', 1500), join('gone', 1600)], 1000, [{ ref: 'c' }])).toBe(1);
  });

  it('no proposal time, or no statements: nothing to say', () => {
    expect(joinsSince([join('c', 1500)], 0, [{ ref: 'c' }])).toBe(0);
    expect(joinsSince(null, 1000, [{ ref: 'c' }])).toBe(0);
  });
});

describe('the Decisions view carries the count on an open proposal', () => {
  it('buildGovernanceView puts joinedSince on an open row (and not on a closed one)', () => {
    const fold = { proposals: [
      { proposalId: 'p1', action: 'removeMember', subject: 'x', votes: [], closed: false, proposedAt: 1000, decision: {} },
      { proposalId: 'p2', action: 'removeMember', subject: 'y', votes: [], closed: true, proposedAt: 1000, decision: {} },
    ] };
    const view = buildGovernanceView({ fold, joinedSinceOf: (p) => (p.proposalId ? 3 : 0) });
    expect(view.open.find((r) => r.proposalId === 'p1')?.joinedSince).toBe(3);
    expect(view.closed.find((r) => r.proposalId === 'p2')?.joinedSince ?? 0).toBe(0);
  });

  it('the host counts from the circle\'s membership statements (read through the agent)', async () => {
    const events = [];
    let t = 1000;
    const members = [{ ref: 'admin0', role: 'admin' }, { ref: 'm0', role: 'member' }, { ref: 'late', role: 'member' }];
    const gov = makeCircleGovernance({
      callSkill: vi.fn(async () => ({ ok: true })),
      readGovernanceState: async () => ({ events, disputed: new Set() }),
      appendGovernanceEvent: async (_c, e) => { events.push(e); },
      getPolicy: async () => normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } }),
      getMembers: async () => members,
      localActorRef: 'admin0', newProposalId: () => 'p1', now: () => t,
      readMembershipBodies: async () => [join('admin0', 10), join('m0', 20), join('late', 5000)],
    });
    await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm0', deadline: 99999 });
    t = 6000;
    const view = await gov.view('c1');
    expect(view.open[0]?.joinedSince).toBe(1);
  });
});
