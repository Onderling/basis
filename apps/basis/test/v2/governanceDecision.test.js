/**
 * Governance decision-classes (Connectivity Phase 4 §5, L4) — the resolver + the policy map.
 *
 * Locks the three classes and the escape-hatch (docs/decisions.md 2026-07-25):
 *   any-admin    → an admin resolves unilaterally; a non-admin can't.
 *   admin-quorum → strict majority of the FULL admin set; pends, or rejects when impossible.
 *   member-vote  → strict majority of the FULL membership; pends if unreachable, with an
 *                  admin-override valve only PAST the deadline (safety over liveness).
 * Thresholds are always over the full roster, never the reachable subset.
 */
import { describe, it, expect } from 'vitest';
import { resolveGovernance, DECISION_STATUS } from '../../src/v2/governanceDecision.js';
import {
  normalizeCirclePolicy, mergeCirclePolicy, decisionClassFor,
  DEFAULT_GOVERNANCE, GOVERNANCE_ACTIONS,
} from '../../src/v2/circlePolicy.js';

const roster = (nMembers, nAdmins) => [
  ...Array.from({ length: nAdmins }, (_, i) => ({ ref: `admin${i}`, role: 'admin' })),
  ...Array.from({ length: nMembers - nAdmins }, (_, i) => ({ ref: `m${i}`, role: 'member' })),
];
const POL = (governance) => normalizeCirclePolicy({ governance });

describe('policy — the governance map', () => {
  it('defaults every action to its DEFAULT_GOVERNANCE class', () => {
    const p = normalizeCirclePolicy({});
    for (const a of GOVERNANCE_ACTIONS) expect(p.governance[a]).toBe(DEFAULT_GOVERNANCE[a]);
    expect(p.governance.removeMember).toBe('any-admin');
    expect(p.governance.changeRule).toBe('admin-quorum');
  });
  it('an invalid class for an action falls back to that action default; a valid one is kept', () => {
    const p = normalizeCirclePolicy({ governance: { removeMember: 'member-vote', rotateKey: 'nonsense' } });
    expect(p.governance.removeMember).toBe('member-vote');   // valid override kept
    expect(p.governance.rotateKey).toBe('any-admin');        // invalid → default
    expect(decisionClassFor(p, 'removeMember')).toBe('member-vote');
  });
  it('merge patches one action without dropping the others', () => {
    const merged = mergeCirclePolicy({}, { governance: { changePolicy: 'member-vote' } });
    expect(merged.governance.changePolicy).toBe('member-vote');
    expect(merged.governance.removeMember).toBe('any-admin');  // untouched
  });
});

describe('any-admin', () => {
  it('an admin actor approves; a member actor is rejected', () => {
    const p = POL({ removeMember: 'any-admin' });
    const members = roster(4, 1);
    expect(resolveGovernance({ action: 'removeMember', policy: p, actor: { ref: 'admin0' }, members }).status).toBe(DECISION_STATUS.APPROVED);
    const r = resolveGovernance({ action: 'removeMember', policy: p, actor: { ref: 'm0' }, members });
    expect(r.status).toBe(DECISION_STATUS.REJECTED);
    expect(r.reason).toBe('not-admin');
  });
});

describe('admin-quorum', () => {
  const p = POL({ changeRule: 'admin-quorum' });
  const members = roster(6, 3);       // 3 admins → need 2
  it('pends until a strict majority of admins vote yes, then approves', () => {
    const one = resolveGovernance({ action: 'changeRule', policy: p, members, votes: [{ voter: 'admin0', choice: 'yes' }] });
    expect(one.status).toBe(DECISION_STATUS.PENDING);
    expect(one.tally).toEqual({ yes: 1, no: 0, need: 2, of: 3 });
    const two = resolveGovernance({ action: 'changeRule', policy: p, members, votes: [{ voter: 'admin0', choice: 'yes' }, { voter: 'admin1', choice: 'yes' }] });
    expect(two.status).toBe(DECISION_STATUS.APPROVED);
  });
  it('rejects once enough admins vote no that a yes-majority is impossible', () => {
    const r = resolveGovernance({ action: 'changeRule', policy: p, members, votes: [{ voter: 'admin0', choice: 'no' }, { voter: 'admin1', choice: 'no' }] });
    expect(r.status).toBe(DECISION_STATUS.REJECTED);
    expect(r.reason).toBe('quorum-impossible');
  });
  it('non-admin votes do not count toward the quorum', () => {
    const r = resolveGovernance({ action: 'changeRule', policy: p, members, votes: [{ voter: 'm0', choice: 'yes' }, { voter: 'm1', choice: 'yes' }] });
    expect(r.status).toBe(DECISION_STATUS.PENDING);
    expect(r.tally.yes).toBe(0);
  });
});

describe('member-vote — full-membership threshold + escape hatch', () => {
  const p = POL({ removeMember: 'member-vote' });
  const members = roster(5, 1);       // 5 members → need 3

  it('approves on a strict majority of the FULL membership', () => {
    const votes = [{ voter: 'admin0', choice: 'yes' }, { voter: 'm0', choice: 'yes' }, { voter: 'm1', choice: 'yes' }];
    const r = resolveGovernance({ action: 'removeMember', policy: p, members, votes });
    expect(r.status).toBe(DECISION_STATUS.APPROVED);
    expect(r.tally).toEqual({ yes: 3, no: 0, need: 3, of: 5 });
  });

  it('a partition that can only muster 2 of 5 yes PENDS — it cannot railroad the decision', () => {
    const votes = [{ voter: 'm0', choice: 'yes' }, { voter: 'm1', choice: 'yes' }];
    const r = resolveGovernance({ action: 'removeMember', policy: p, members, votes, deadline: 100, now: 50 });
    expect(r.status).toBe(DECISION_STATUS.PENDING);
    expect(r.reason).toBe('awaiting-votes');
    expect(r.overrideAvailable).toBe(false);        // before the deadline, no override
  });

  it('past the deadline the vote still pends, but an admin override is now available', () => {
    const votes = [{ voter: 'm0', choice: 'yes' }, { voter: 'm1', choice: 'yes' }];
    const pend = resolveGovernance({ action: 'removeMember', policy: p, members, votes, deadline: 100, now: 200 });
    expect(pend.status).toBe(DECISION_STATUS.PENDING);
    expect(pend.reason).toBe('deadline-passed');
    expect(pend.overrideAvailable).toBe(true);
    // an ADMIN forcing it past the deadline resolves it
    const forced = resolveGovernance({ action: 'removeMember', policy: p, members, votes, deadline: 100, now: 200, override: true, actor: { ref: 'admin0' } });
    expect(forced.status).toBe(DECISION_STATUS.APPROVED);
    expect(forced.reason).toBe('admin-override');
    // a MEMBER cannot force it, even past the deadline
    const notForced = resolveGovernance({ action: 'removeMember', policy: p, members, votes, deadline: 100, now: 200, override: true, actor: { ref: 'm0' } });
    expect(notForced.status).toBe(DECISION_STATUS.PENDING);
  });

  it('a no-majority rejects (a clear NO, no deadlock)', () => {
    const votes = [{ voter: 'm0', choice: 'no' }, { voter: 'm1', choice: 'no' }, { voter: 'm2', choice: 'no' }];
    const r = resolveGovernance({ action: 'removeMember', policy: p, members, votes });
    expect(r.status).toBe(DECISION_STATUS.REJECTED);
    expect(r.reason).toBe('rejected-by-majority');
  });

  it('a voter changing their mind counts only their LAST vote', () => {
    const votes = [
      { voter: 'm0', choice: 'yes', at: 1 }, { voter: 'm0', choice: 'no', at: 2 },   // m0 flipped to no
      { voter: 'm1', choice: 'yes', at: 1 }, { voter: 'admin0', choice: 'yes', at: 1 },
    ];
    const r = resolveGovernance({ action: 'removeMember', policy: p, members, votes });
    expect(r.tally).toEqual({ yes: 2, no: 1, need: 3, of: 5 });   // m0's yes did not double-count
    expect(r.status).toBe(DECISION_STATUS.PENDING);
  });
});

describe('unknown action', () => {
  it('is rejected rather than silently approved', () => {
    const r = resolveGovernance({ action: 'nukeEverything', policy: normalizeCirclePolicy({}), actor: { ref: 'admin0' }, members: roster(3, 1) });
    expect(r.status).toBe(DECISION_STATUS.REJECTED);
    expect(r.decisionClass).toBeNull();
  });
});
