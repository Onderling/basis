/**
 * THE "A DECISION OPENED" LINE IS A WAY IN (Fable's ruling on L887, 2026-11-14): a member hears of an open decision as a
 * line in the circle's conversation; the line carries one button that opens the circle's Decisions screen, the same
 * target as the circle menu's entry. A decision that has since closed is on the same screen, in its settled list.
 */
import { describe, it, expect } from 'vitest';
import { governanceNoticeRows, GOVERNANCE_OPEN_ACTION } from '../../src/v2/governanceNotices.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);
const propose = (id, by, action = 'removeMember') => ({
  id, ts: 1, type: 'governance', circleId: 'c1',
  payload: { body: { kind: 'propose', author: by, payload: { action, authorRef: by } } },
});

describe('the "a decision opened" line', () => {
  it('carries one button that opens the Decisions screen', () => {
    const [row] = governanceNoticeRows({ events: [propose('e1', 'anna')], circleId: 'c1', viewerId: 'bram', t });
    expect(row.event.payload.notice).toBe('decisionOpened');
    expect(row.event.payload.buttons).toEqual([{ id: GOVERNANCE_OPEN_ACTION, action: GOVERNANCE_OPEN_ACTION, labelKey: 'circle.governance.open_from_notice' }]);
    expect(GOVERNANCE_OPEN_ACTION).toBe('open:governance');
  });

  it('the proposer gets no line, and so no button', () => {
    expect(governanceNoticeRows({ events: [propose('e1', 'anna')], circleId: 'c1', viewerId: 'anna', t })).toEqual([]);
  });
});
