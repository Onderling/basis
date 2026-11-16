/**
 * ENACTING SAYS WHAT IT DID, OR WHY IT COULD NOT (L893, Fable 2026-11-14): the admin's Enact on an approved decision
 * that waits. What `tally` answered becomes one line, the same on both shells.
 */
import { describe, it, expect } from 'vitest';
import { enactOutcomeLine } from '../../src/v2/governanceView.js';

describe('the line after Enact', () => {
  it('enacted: says it is done', () => {
    expect(enactOutcomeLine({ ok: true, status: 'approved', enacted: true })).toEqual({ key: 'circle.governance.enacted', failed: false });
    expect(enactOutcomeLine({ ok: true, status: 'approved', closed: true })).toEqual({ key: 'circle.governance.enacted', failed: false });
  });
  it('could not: says so, never looks done', () => {
    for (const r of [{ ok: true, status: 'approved', awaitingEnactment: true }, { ok: false, reason: 'no-proposal' }, { ok: true, status: 'approved', enacted: false }, null, new Error('x')]) {
      expect(enactOutcomeLine(r), JSON.stringify(r)).toEqual({ key: 'circle.governance.enact_failed', failed: true });
    }
  });
});
