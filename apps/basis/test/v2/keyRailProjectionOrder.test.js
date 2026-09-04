/**
 * The key-lane projection orders re-issues by CHAIN, not by arrival. A same-version re-issue (a grant that
 * widens the audience) supersedes the earlier one last-wins in the fold — so the projection must hand the
 * fold the author's chain order. A device catching up from a peer that stores newest-first received the
 * widened grant BEFORE the narrower original, and the fold kept the narrower one (2026-09-04).
 */
import { describe, it, expect } from 'vitest';
import { keyEventsFromRail } from '../../src/v2/keyRail.js';

const body = ({ hash, parent, recipients }) => ({
  kind: 'key-establish', subject: 'v1', author: 'admin-addr', hash, parentHash: parent,
  payload: { event: { kind: 'group-key-event', version: 1, sealed: 'x', recipients } },
});

describe('keyEventsFromRail — chain order', () => {
  it('returns an author\'s statements in parent order whatever order the rail stored them', async () => {
    const stored = [
      body({ hash: 'c', parent: 'b', recipients: ['k1', 'k2', 'k3'] }),   // newest first, as a catch-up delivers
      body({ hash: 'b', parent: 'a', recipients: ['k1', 'k2'] }),
      body({ hash: 'a', parent: null, recipients: ['k1'] }),
    ];
    const rail = { readVerifiedBodies: async () => ({ bodies: stored }) };
    const events = await keyEventsFromRail(rail, 'g');
    expect(events.map((e) => e.recipients.length)).toEqual([1, 2, 3]);
  });
});
