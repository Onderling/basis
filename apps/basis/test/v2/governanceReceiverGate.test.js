/**
 * THE RECEIVER GATE: a carried rules or settings change is applied only when the circle's rule allowed it.
 * Over a real fold (`foldGovernance`) of governance events, as a device holds them.
 */
import { describe, it, expect } from 'vitest';
import { writeSkippedTheVote, writeNeedsVote } from '../../src/v2/governanceReceiverGate.js';
import { foldGovernance, proposeEvent, voteEvent, resolveEvent } from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';

const twoAdmins = [{ ref: 'a0', role: 'admin' }, { ref: 'a1', role: 'admin' }, { ref: 'm0', role: 'member' }];
const quorum = normalizeCirclePolicy({ governance: { changeRule: 'admin-quorum', changePolicy: 'admin-quorum' } });
const anyAdmin = normalizeCirclePolicy({ governance: { changeRule: 'any-admin', changePolicy: 'any-admin' } });
const rules = { purpose: 'Samen koken', agreements: 'Om de beurt' };
const rulesWrite = (extra = {}) => ({ payload: { rules, version: 3, ...extra } });

const fold = (events, policy = quorum) => foldGovernance(events.map((e) => ({ ...e, kind: 'governance' })), { policy, members: twoAdmins, now: 1 }).proposals;

describe('when a write needs a decided proposal', () => {
  it('any-admin: never; admin-quorum: only with two admins or more; member-vote: always', () => {
    expect(writeNeedsVote(anyAdmin, 'changeRule', twoAdmins)).toBe(false);
    expect(writeNeedsVote(quorum, 'changeRule', twoAdmins)).toBe(true);
    expect(writeNeedsVote(quorum, 'changeRule', [{ ref: 'a0', role: 'admin' }])).toBe(false);
    expect(writeNeedsVote(normalizeCirclePolicy({ governance: { changeRule: 'member-vote' } }), 'changeRule', [{ ref: 'a0', role: 'admin' }])).toBe(true);
  });
});

describe('a rules change', () => {
  it('under any-admin an admin\'s write stands on its own', () => {
    expect(writeSkippedTheVote({ action: 'changeRule', body: rulesWrite(), policy: anyAdmin, members: twoAdmins, proposals: [] })).toBe(false);
  });

  it('under admin-quorum, a write that names no proposal skipped the vote', () => {
    expect(writeSkippedTheVote({ action: 'changeRule', body: rulesWrite(), policy: quorum, members: twoAdmins, proposals: [] })).toBe(true);
  });

  it('a write naming a proposal both admins approved, about the same rules, stands', () => {
    const proposals = fold([
      proposeEvent({ proposalId: 'p1', action: 'changeRule', subject: rules, by: 'a0', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a0', choice: 'yes', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a1', choice: 'yes', at: 0 }),
    ]);
    expect(writeSkippedTheVote({ action: 'changeRule', body: rulesWrite({ proposalId: 'p1' }), policy: quorum, members: twoAdmins, proposals })).toBe(false);
  });

  it('a proposal only its proposer voted for, closed "approved" by the proposer\'s own resolve, does not count', () => {
    const proposals = fold([
      proposeEvent({ proposalId: 'p1', action: 'changeRule', subject: rules, by: 'a0', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a0', choice: 'yes', at: 0 }),
      resolveEvent({ proposalId: 'p1', status: 'approved', by: 'a0', at: 0 }),
    ]);
    expect(writeSkippedTheVote({ action: 'changeRule', body: rulesWrite({ proposalId: 'p1' }), policy: quorum, members: twoAdmins, proposals })).toBe(true);
  });

  it('an approved proposal about OTHER rules does not cover this write', () => {
    const proposals = fold([
      proposeEvent({ proposalId: 'p1', action: 'changeRule', subject: { ...rules, agreements: 'Iets anders' }, by: 'a0', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a0', choice: 'yes', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a1', choice: 'yes', at: 0 }),
    ]);
    expect(writeSkippedTheVote({ action: 'changeRule', body: rulesWrite({ proposalId: 'p1' }), policy: quorum, members: twoAdmins, proposals })).toBe(true);
  });

  it('an approved proposal of ANOTHER action does not cover this write', () => {
    const proposals = fold([
      proposeEvent({ proposalId: 'p1', action: 'changePolicy', subject: rules, by: 'a0', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a0', choice: 'yes', at: 0 }),
      voteEvent({ proposalId: 'p1', voter: 'a1', choice: 'yes', at: 0 }),
    ]);
    expect(writeSkippedTheVote({ action: 'changeRule', body: rulesWrite({ proposalId: 'p1' }), policy: quorum, members: twoAdmins, proposals })).toBe(true);
  });
});

describe('a settings change', () => {
  const stated = (extra = {}) => ({ payload: { policy: { ...quorum, chat: 'off', governance: quorum.governance }, version: 4, ...extra } });
  it('a write that carries the approved patch stands; the founding write (version 1) is never judged', () => {
    const proposals = fold([
      proposeEvent({ proposalId: 'p2', action: 'changePolicy', subject: { chat: 'off' }, by: 'a0', at: 0 }),
      voteEvent({ proposalId: 'p2', voter: 'a0', choice: 'yes', at: 0 }),
      voteEvent({ proposalId: 'p2', voter: 'a1', choice: 'yes', at: 0 }),
    ]);
    expect(writeSkippedTheVote({ action: 'changePolicy', body: stated({ proposalId: 'p2' }), policy: quorum, members: twoAdmins, proposals })).toBe(false);
    expect(writeSkippedTheVote({ action: 'changePolicy', body: stated(), policy: quorum, members: twoAdmins, proposals })).toBe(true);
    expect(writeSkippedTheVote({ action: 'changePolicy', body: { payload: { policy: quorum, version: 1 } }, policy: quorum, members: twoAdmins, proposals: [] })).toBe(false);
  });
});
