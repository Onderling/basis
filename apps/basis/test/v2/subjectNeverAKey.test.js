/**
 * A PERSON ON THE DECISIONS SCREEN IS NEVER A KEY (L897, second part, 2026-11-14): a proposal's subject (who is removed,
 * whose role changes), a disputed author, and whoever made a change without the vote are named from this device's own
 * roster; "a member who has left" when the roster no longer holds them; never the key. One labeler, both shells.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { subjectLabelerFor, buildGovernanceView } from '../../src/v2/governanceView.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const t = (k) => k;
const label = subjectLabelerFor([{ webid: 'k-bram', displayName: 'Bram' }], t);
const KEY = 'k-gone-0123456789abcdef0123456789abcdef';

describe('a person on the Decisions screen is never a key', () => {
  it('a member in the roster: their name', () => {
    expect(label('k-bram', 'removeMember')).toBe('Bram');
    expect(label('k-bram', 'member')).toBe('Bram');
  });
  it('a person the roster no longer holds: "a member who has left"', () => {
    for (const action of ['removeMember', 'changeRole', 'member']) expect(label(KEY, action), action).toBe('circle.governance.member_left');
  });
  it('a subject that is not a person keeps its value', () => {
    expect(label('quiet-hours', 'changeRule')).toBe('quiet-hours');
    expect(label(null, 'removeMember')).toBe('');
  });
  it('the view: a removal of someone who has left is labelled as such, and a role change too', () => {
    const view = buildGovernanceView({
      fold: { proposals: [
        { proposalId: 'p1', action: 'removeMember', subject: KEY, by: 'k-bram', status: DECISION_STATUS.PENDING, closed: false, votes: [], decision: { decisionClass: 'member-vote' } },
        { proposalId: 'p2', action: 'changeRole', subject: { member: KEY, role: 'admin' }, by: 'k-bram', status: DECISION_STATUS.PENDING, closed: false, votes: [], decision: { decisionClass: 'any-admin' } },
      ] },
      viewer: { ref: 'k-bram', role: 'admin' }, labelForSubject: label,
    });
    expect(view.open.map((r) => r.subjectLabel)).toEqual(['circle.governance.member_left', 'circle.governance.member_left']);
  });
  it('both shells and the binding use the shared labeler; no key fallback is left beside it', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const [name, src] of [['web', read('../../web/v2/circleApp.js')], ['phone', read('../../../basis-mobile/src/screens/v2/CircleGovernanceScreen.js')]]) {
      expect(src, name).toMatch(/subjectLabelerFor\(roster, t\)/);
      expect(src, name).not.toMatch(/nameOf\(s\) \?\? \(s == null \? '' : String\(s\)\)/);
    }
    const wiring = read('../../src/v2/governanceAppWiring.js');
    expect(wiring).toMatch(/label\(r\.by, 'member'\)/);
    expect(wiring).not.toMatch(/label\(r\.by, r\.action\) \|\| r\.by/);
  });
});
