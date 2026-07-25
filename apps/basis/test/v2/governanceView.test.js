/**
 * Governance surface view-model (Phase 4 §5, L4 slice 3) — the shared read-model.
 *
 * Locks the viewer-relative affordances both shells render off: open vs closed split,
 * this viewer's own vote, who may vote (member on an open member-vote), and when the admin
 * override shows (member-vote, admin, past deadline).
 */
import { describe, it, expect } from 'vitest';
import { buildGovernanceView } from '../../src/v2/governanceView.js';
import { foldGovernance, proposeEvent, voteEvent, resolveEvent } from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const members5 = [
  { ref: 'admin0', role: 'admin' },
  { ref: 'm0', role: 'member' }, { ref: 'm1', role: 'member' },
  { ref: 'm2', role: 'member' }, { ref: 'm3', role: 'member' },
];
const POL = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });

const foldOf = (events, now = 50) => foldGovernance(events, { policy: POL, members: members5, now });

describe('buildGovernanceView', () => {
  it('an open member-vote: a member can vote and sees their own choice; the tally shows', () => {
    const fold = foldOf([
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 }),
    ]);
    const v = buildGovernanceView({ fold, viewer: { ref: 'm0', role: 'member' }, labelForSubject: (s) => `member:${s}` });
    expect(v.hasOpen).toBe(true);
    const row = v.open[0];
    expect(row).toMatchObject({ action: 'removeMember', subjectLabel: 'member:m3', decisionClass: 'member-vote', canVote: true, myVote: 'yes', pending: true });
    expect(row.tally).toEqual({ yes: 1, no: 0, need: 3, of: 5 });
    expect(row.canOverride).toBe(false);      // not past deadline
  });

  it('a member who has not voted shows myVote null but can vote', () => {
    const fold = foldOf([proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 })]);
    const row = buildGovernanceView({ fold, viewer: { ref: 'm2', role: 'member' } }).open[0];
    expect(row.myVote).toBeNull();
    expect(row.canVote).toBe(true);
  });

  it('the admin override appears only for an admin, only past the deadline', () => {
    const events = [proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 }), voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 })];
    const past = foldGovernance(events, { policy: POL, members: members5, now: 200 });
    const adminView = buildGovernanceView({ fold: past, viewer: { ref: 'admin0', role: 'admin' } }).open[0];
    expect(adminView.overrideAvailable).toBe(true);
    expect(adminView.canOverride).toBe(true);
    // a plain member never gets the override, even past the deadline
    const memberView = buildGovernanceView({ fold: past, viewer: { ref: 'm0', role: 'member' } }).open[0];
    expect(memberView.canOverride).toBe(false);
  });

  it('a resolved proposal lands in `closed` with its recorded outcome, not open', () => {
    const fold = foldOf([
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', at: 1 }),
      resolveEvent({ proposalId: 'p1', status: DECISION_STATUS.APPROVED, by: 'admin0', at: 9 }),
    ]);
    const v = buildGovernanceView({ fold, viewer: { ref: 'm0', role: 'member' } });
    expect(v.open).toHaveLength(0);
    expect(v.closed[0]).toMatchObject({ closed: true, approved: true, canVote: false });
  });
});
