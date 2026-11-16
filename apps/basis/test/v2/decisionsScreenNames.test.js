/**
 * THE DECISIONS SCREEN NAMES PEOPLE, AND OFFERS ONLY WHAT CAN STILL BE DONE (L897, found on the phone 2026-11-14):
 *   - a report about a member showed the member's KEY when the report carried no label, and otherwise the name the
 *     REPORTER chose. The admin's screen names the member from ITS OWN roster, as a proposal's subject is named;
 *     "a member who has left" when the roster no longer holds them; never the key. A post or a message keeps the
 *     reporter's own words about it (there is no roster for those), never a key either.
 *   - a decision already approved (waiting for an admin to enact it) still offered Yes and No.
 */
import { describe, it, expect } from 'vitest';
import { reportTargetText, buildSubjectLabeler, buildGovernanceView } from '../../src/v2/governanceView.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);
const nameOf = buildSubjectLabeler([{ webid: 'k-bram', displayName: 'Bram' }]);

describe('a report names its target from the admin\'s own roster', () => {
  it('a member in the roster: their name there, not the reporter\'s label', () => {
    expect(reportTargetText({ targetType: 'member', targetRef: 'k-bram', targetLabel: 'that guy' }, { nameOf, t }))
      .toBe('circle.governance.report_target.member: Bram');
  });
  it('a member no longer in the roster: "a member who has left", never the key', () => {
    const line = reportTargetText({ targetType: 'member', targetRef: 'k-gone-0123456789abcdef', targetLabel: null }, { nameOf, t });
    expect(line).toBe('circle.governance.report_target.member: circle.governance.member_left');
    expect(line).not.toContain('k-gone');
  });
  it('a post or a message: the reporter\'s words about it, or just its kind; never a key', () => {
    expect(reportTargetText({ targetType: 'post', targetRef: 'post-abc', targetLabel: 'the bike ad' }, { nameOf, t })).toBe('circle.governance.report_target.post: the bike ad');
    expect(reportTargetText({ targetType: 'message', targetRef: 'msg-xyz', targetLabel: null }, { nameOf, t })).toBe('circle.governance.report_target.message');
  });
});

describe('a decision that is approved offers no vote', () => {
  it('approved and waiting for an admin: no Yes and No for anyone', () => {
    const p = { proposalId: 'p1', action: 'removeMember', subject: 'cas', by: 'anna', status: DECISION_STATUS.APPROVED, closed: false, votes: [], decision: { decisionClass: 'member-vote' } };
    for (const viewer of [{ ref: 'bea', role: 'member' }, { ref: 'anna', role: 'admin' }]) {
      expect(buildGovernanceView({ fold: { proposals: [p] }, viewer }).open[0].canVote, viewer.role).toBe(false);
    }
  });
  it('still pending: a member votes as before', () => {
    const p = { proposalId: 'p1', action: 'removeMember', subject: 'cas', by: 'anna', status: DECISION_STATUS.PENDING, closed: false, votes: [], decision: { decisionClass: 'member-vote' } };
    expect(buildGovernanceView({ fold: { proposals: [p] }, viewer: { ref: 'bea', role: 'member' } }).open[0].canVote).toBe(true);
  });
});
