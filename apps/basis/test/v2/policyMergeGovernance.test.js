/**
 * TWO ADMINS CHANGE THE SETTINGS AT ONCE: the stricter "who decides" wins for each act, whoever said it — never the
 * statement whose hash happens to sort first. A tightening that arrives beside an unrelated change is not lost.
 */
import { describe, it, expect } from 'vitest';
import { denyWinsMerge, foldPolicyUpdates } from '../../src/v2/policyUpdateLane.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';

const loose = { removeMember: 'any-admin', changePolicy: 'any-admin', changeRule: 'any-admin' };

describe('concurrent settings changes merge "who decides" strictest-first', () => {
  it('a tightening of removals survives a concurrent change of something else, in either hash order', () => {
    const tighten = normalizeCirclePolicy({ governance: { ...loose, removeMember: 'member-vote' } });
    const other = normalizeCirclePolicy({ governance: loose });   // B changed something else and carried the old "who decides"
    for (const [h1, h2] of [['a', 'b'], ['b', 'a']]) {
      const bodies = [
        { kind: 'policy-update', author: 'A', hash: h1, payload: { policy: tighten, version: 2 } },
        { kind: 'policy-update', author: 'B', hash: h2, payload: { policy: other, version: 2 } },
      ];
      const merged = foldPolicyUpdates(bodies, { admins: new Set(['A', 'B']) }).policy;
      expect(merged.governance.removeMember, `hash order ${h1}/${h2}`).toBe('member-vote');
    }
  });
  it('per act: member-vote before admin-quorum before any-admin', () => {
    const m = denyWinsMerge([
      { governance: { removeMember: 'any-admin', changePolicy: 'admin-quorum', changeRule: 'member-vote' } },
      { governance: { removeMember: 'admin-quorum', changePolicy: 'member-vote', changeRule: 'any-admin' } },
    ]);
    expect(m.governance).toMatchObject({ removeMember: 'admin-quorum', changePolicy: 'member-vote', changeRule: 'member-vote' });
  });
});
