/**
 * THE VOTE FREEZE: a vote counts only the members from before the proposal, minus anyone who left since.
 */
import { describe, it, expect } from 'vitest';
import { membershipFrontier, admissionWithin, proposalRoster, authorTip } from '../../src/v2/voteFreeze.js';
import { resolveGovernance } from '../../src/v2/governanceDecision.js';
import { foldGovernance, proposeEvent, voteEvent } from '../../src/v2/governanceLog.js';

// a small membership lane: the founder (no join), then joins chained on the admin's own chain
const b = (hash, kind, subject, parentHash = null, author = 'ann') => ({ hash, kind, subject, author, parentHash, deps: [] });
const before = [b('h1', 'join', 'bob', null), b('h2', 'join', 'cas', 'h1')];
const packed = [b('h3', 'join', 'x1', 'h2'), b('h4', 'join', 'x2', 'h3')];
const roster = (refs) => refs.map((ref) => ({ ref, role: ref === 'ann' ? 'admin' : 'member' }));
const POLICY = { governance: { removeMember: 'member-vote' } };

describe('the vote freeze', () => {
  it('the frontier is what nothing builds on', () => {
    expect(membershipFrontier([...before, ...packed])).toEqual(['h4']);
  });

  it('members admitted AFTER the proposal never count: packing the vote fails', () => {
    const heads = membershipFrontier(before);                       // the circle when ann proposed: ann, bob, cas
    const bodies = [...before, ...packed];                          // then ann admits x1, x2
    const now = roster(['ann', 'bob', 'cas', 'x1', 'x2']);
    const r = proposalRoster({ membershipHeads: heads }, { members: now, admissionFor: (h) => admissionWithin(bodies, h) });
    expect(r.members.map((m) => m.ref).sort()).toEqual(['ann', 'bob', 'cas']);
    // the removal of bob: ann + her two new accounts vote yes; on the frozen roster that is 1 of 3, not 3 of 5
    const votes = ['ann', 'x1', 'x2'].map((voter) => ({ voter, choice: 'yes' }));
    const packedTally = resolveGovernance({ action: 'removeMember', policy: POLICY, members: now, votes, subject: 'bob' });
    const frozenTally = resolveGovernance({ action: 'removeMember', policy: POLICY, members: r.members, votes, subject: 'bob' });
    expect(packedTally.status, 'without the freeze the packed vote passes').toBe('approved');
    expect(frozenTally.status, 'with it, it does not').not.toBe('approved');
  });

  it('a member admitted BEFORE the proposal votes and counts', () => {
    const r = proposalRoster({ membershipHeads: ['h2'] }, { members: roster(['ann', 'bob', 'cas']), admissionFor: (h) => admissionWithin(before, h) });
    expect(r.members.map((m) => m.ref)).toContain('cas');
  });

  it('a member who LEFT after the proposal does not count, and leaves the base', () => {
    const bodies = [...before, b('h5', 'leave', 'cas', null, 'cas')];
    const r = proposalRoster({ membershipHeads: ['h2'] }, { members: roster(['ann', 'bob', 'cas']), admissionFor: (h) => admissionWithin(bodies, h) });
    expect(r.members.map((m) => m.ref).sort()).toEqual(['ann', 'bob']);
  });

  it('a device missing a named head keeps the proposal waiting (never counted on a partial roster)', () => {
    const r = proposalRoster({ membershipHeads: ['h9'] }, { members: roster(['ann', 'bob']), admissionFor: (h) => admissionWithin(before, h) });
    expect(r.waiting).toBe(true);
    expect(r.members).toEqual([]);
  });

  it('a proposal made before the freeze (no heads) counts on the roster as it is now', () => {
    const now = roster(['ann', 'bob', 'x1']);
    expect(proposalRoster({}, { members: now, admissionFor: () => ({ missing: [] }) }).members).toEqual(now);
  });

  it('the fold uses the frozen roster for every proposal', () => {
    const heads = membershipFrontier(before);
    const bodies = [...before, ...packed];
    const events = [
      { ...proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'bob', by: 'ann', at: 1 }), membershipHeads: heads, hash: 'g1' },
      ...['ann', 'x1', 'x2'].map((voter, i) => ({ ...voteEvent({ proposalId: 'p1', voter, choice: 'yes', at: 2 + i }), hash: `v${i}` })),
    ];
    const fold = foldGovernance(events, { policy: POLICY, members: roster(['ann', 'bob', 'cas', 'x1', 'x2']), now: 10, admissionFor: (h) => admissionWithin(bodies, h) });
    expect(fold.proposals[0].status).not.toBe('approved');
  });
  it('a proposal whose heads leave out the proposer\'s own admissions counts for nothing', () => {
    // ann's own chain reaches h4 (she admitted x1, x2); she names the heads before them
    const bodies = [...before, ...packed];
    expect(authorTip(bodies, 'ann')).toBe('h4');
    const r = proposalRoster({ membershipHeads: ['h2'], membershipUpTo: 'h4' }, { members: roster(['ann', 'bob', 'cas', 'x1', 'x2']), admissionFor: (h) => admissionWithin(bodies, h) });
    expect(r.behindProposer).toBe(true);
    expect(r.members).toEqual([]);
  });

  // KNOWN LIMIT (on the row): where removals are NOT governed (any-admin), an admin who removes a voter mid-vote shrinks
  // the base; the freeze cannot stop that, only a governed removal can.
  it('known limit: an admin removal mid-vote shrinks the base (removals not governed)', () => {
    const bodies = [...before, b('h6', 'evict', 'cas', 'h2')];
    const r = proposalRoster({ membershipHeads: ['h2'] }, { members: roster(['ann', 'bob']), admissionFor: (h) => admissionWithin(bodies, h) });
    expect(r.members.map((m) => m.ref).sort()).toEqual(['ann', 'bob']);
  });
});
