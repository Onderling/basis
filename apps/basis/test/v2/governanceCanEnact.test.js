/**
 * WHO SEES "ENACT" (L893, Fable 2026-11-14): the circle's default is that an admin enacts an approved decision
 * explicitly ('settle', Decision B 2026-07-26), and no shell offered that act, so an approved removal never landed. One
 * shared decision of who sees it: an admin (Decision A: only an admin/caretaker device enacts), on a card that is
 * approved and waits. Everyone else keeps the waiting line.
 */
import { describe, it, expect } from 'vitest';
import { buildGovernanceView } from '../../src/v2/governanceView.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const proposal = (over = {}) => ({
  proposalId: 'p1', action: 'removeMember', subject: 'cas', by: 'anna', status: DECISION_STATUS.APPROVED, closed: false,
  votes: [], decision: { decisionClass: 'member-vote', tally: { yes: 2, no: 0, need: 2, of: 3 } }, ...over,
});
const rowFor = (p, viewer) => buildGovernanceView({ fold: { proposals: [p] }, viewer }).open[0] ?? buildGovernanceView({ fold: { proposals: [p] }, viewer }).closed[0];

describe('who sees Enact on a decision', () => {
  it('an admin, on an approved card that waits', () => {
    expect(rowFor(proposal(), { ref: 'anna', role: 'admin' }).canEnact).toBe(true);
  });
  it('a member does not: they keep the waiting line', () => {
    const row = rowFor(proposal(), { ref: 'bea', role: 'member' });
    expect(row.canEnact).toBe(false);
    expect(row.awaitingEnactment).toBe(true);
  });
  it('nobody, on a card still open, rejected, or already closed', () => {
    for (const p of [proposal({ status: DECISION_STATUS.PENDING }), proposal({ status: DECISION_STATUS.REJECTED }), proposal({ closed: true })]) {
      expect(rowFor(p, { ref: 'anna', role: 'admin' }).canEnact, JSON.stringify({ s: p.status, c: p.closed })).toBe(false);
    }
  });
  it('no viewer known: nobody', () => {
    expect(rowFor(proposal(), null).canEnact).toBe(false);
  });
});
