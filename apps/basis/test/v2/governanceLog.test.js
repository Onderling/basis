/**
 * Governance proposals — the event model + fold (Phase 4 §5, L4).
 *
 * The fold groups governance events into proposals and resolves each live status through
 * the (separately-tested) decision resolver. Locks: grouping by proposal, votes flowing to
 * the resolver, a `resolve` event closing a proposal with its recorded outcome, and orphan
 * events (a vote with no propose) being dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  proposeEvent, voteEvent, resolveEvent, foldGovernance, openProposals, GOV_EVENT,
} from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const members5 = [
  { ref: 'admin0', role: 'admin' },
  { ref: 'm0', role: 'member' }, { ref: 'm1', role: 'member' },
  { ref: 'm2', role: 'member' }, { ref: 'm3', role: 'member' },
];
const VOTE_POLICY = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });

describe('foldGovernance', () => {
  it('builds a member-vote proposal and resolves its live status from the votes', () => {
    const events = [
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'admin0', choice: 'yes', at: 2 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 3 }),
    ];
    const { proposals } = foldGovernance(events, { policy: VOTE_POLICY, members: members5, now: 50 });
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p).toMatchObject({ action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, closed: false });
    // 2 of 5 yes, needs 3 → pending
    expect(p.status).toBe(DECISION_STATUS.PENDING);
    expect(p.decision.tally).toEqual({ yes: 2, no: 0, need: 3, of: 5 });
    expect(p.votes).toHaveLength(2);
  });

  it('reaches APPROVED once a full-membership majority is present', () => {
    const events = [
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'admin0', choice: 'yes', at: 2 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 3 }),
      voteEvent({ proposalId: 'p1', voter: 'm1', choice: 'yes', at: 4 }),
    ];
    const { proposals } = foldGovernance(events, { policy: VOTE_POLICY, members: members5, now: 50 });
    expect(proposals[0].status).toBe(DECISION_STATUS.APPROVED);
  });

  it('a resolve event closes the proposal and keeps its recorded outcome (out of openProposals)', () => {
    const events = [
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 }),
      resolveEvent({ proposalId: 'p1', status: DECISION_STATUS.APPROVED, by: 'admin0', at: 9 }),
    ];
    const fold = foldGovernance(events, { policy: VOTE_POLICY, members: members5, now: 50 });
    const p = fold.proposals[0];
    expect(p.closed).toBe(true);
    expect(p.status).toBe(DECISION_STATUS.APPROVED);   // recorded outcome, not the live tally
    expect(openProposals(fold)).toHaveLength(0);
  });

  it('groups multiple proposals; open sort before closed', () => {
    const events = [
      proposeEvent({ proposalId: 'closed', action: 'changeRule', by: 'admin0', at: 1 }),
      resolveEvent({ proposalId: 'closed', status: DECISION_STATUS.REJECTED, at: 2 }),
      proposeEvent({ proposalId: 'open', action: 'removeMember', subject: 'm3', by: 'admin0', at: 3 }),
    ];
    const { proposals } = foldGovernance(events, { policy: VOTE_POLICY, members: members5, now: 50 });
    expect(proposals.map((p) => p.proposalId)).toEqual(['open', 'closed']);  // open first
  });

  it('drops orphan events (a vote with no matching propose)', () => {
    const { proposals } = foldGovernance(
      [voteEvent({ proposalId: 'ghost', voter: 'm0', choice: 'yes', at: 1 })],
      { policy: VOTE_POLICY, members: members5, now: 50 },
    );
    expect(proposals).toHaveLength(0);
  });

  it('the event builders carry the governance kind + shape', () => {
    expect(proposeEvent({ proposalId: 'p', action: 'removeMember', by: 'a' }))
      .toMatchObject({ kind: 'governance', event: GOV_EVENT.PROPOSE, proposalId: 'p', action: 'removeMember' });
    expect(voteEvent({ proposalId: 'p', voter: 'm0', choice: 'no' }))
      .toMatchObject({ kind: 'governance', event: GOV_EVENT.VOTE, choice: 'no' });
  });
});
