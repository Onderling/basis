/**
 * A VOTE THAT FAILED MUST NOT LOOK CAST (Fable, L887): both shells swallowed the vote's result, so a refused or thrown
 * vote left the screen exactly as a cast one. The shared decision: the line a shell shows for a vote's outcome.
 */
import { describe, it, expect } from 'vitest';
import { voteFailedLine } from '../../src/v2/governanceView.js';

describe('the line a shell shows after a vote', () => {
  it('nothing when the vote went through (pending, approved, awaiting enactment)', () => {
    for (const r of [{ ok: true, status: 'pending' }, { ok: true, status: 'approved', awaitingEnactment: true }]) expect(voteFailedLine(r)).toBeNull();
  });
  it('says so when it was refused, threw, or answered nothing', () => {
    expect(voteFailedLine({ ok: false, reason: 'bad-choice' })).toBe('circle.governance.vote_failed');
    expect(voteFailedLine(null)).toBe('circle.governance.vote_failed');
    expect(voteFailedLine(new Error('x'))).toBe('circle.governance.vote_failed');
  });
});
