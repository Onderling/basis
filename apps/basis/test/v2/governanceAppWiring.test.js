/**
 * Governance app wiring (Phase 4 §5, L4 slice 3) — the shared shell binder.
 *
 * Locks the substrate binding both shells depend on: governance events round-trip through
 * the EventLog (append as a governance-kind silent entry → read back by circle), and the
 * full membership is assembled from the roster op PLUS this device (which listGroupRoster
 * excludes), with roles honoured.
 */
import { describe, it, expect, vi } from 'vitest';
import { readCircleMembers, bindCircleGovernance } from '../../src/v2/governanceAppWiring.js';
import { EventLog } from '../../src/eventLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

describe('readCircleMembers', () => {
  it('adds this device to the roster (which excludes the caller) and honours roles', async () => {
    const callSkill = vi.fn(async () => ({ members: [{ addr: 'admin0', role: 'admin' }, { addr: 'm1', role: 'member' }] }));
    const members = await readCircleMembers({ callSkill, circleId: 'c1', myRef: 'me', getPolicy: async () => ({}) });
    expect(members).toContainEqual({ ref: 'me', role: 'member' });      // I'm added (a member — an admin exists)
    expect(members).toContainEqual({ ref: 'admin0', role: 'admin' });
    expect(members).toHaveLength(3);
  });

  it('sole-admin fallback: if no admin appears among the others, I am the admin', async () => {
    const callSkill = vi.fn(async () => ({ members: [{ addr: 'm1', role: 'member' }] }));
    const members = await readCircleMembers({ callSkill, circleId: 'c1', myRef: 'me', getPolicy: async () => ({}) });
    expect(members.find((m) => m.ref === 'me').role).toBe('admin');
  });

  it('policy.admins is authoritative when present', async () => {
    const callSkill = vi.fn(async () => ({ members: [{ addr: 'm1', role: 'member' }] }));
    const members = await readCircleMembers({ callSkill, circleId: 'c1', myRef: 'me', getPolicy: async () => ({ admins: ['m1'] }) });
    expect(members.find((m) => m.ref === 'm1').role).toBe('admin');
    expect(members.find((m) => m.ref === 'me').role).toBe('member');   // not in policy.admins
  });
});

describe('bindCircleGovernance — EventLog round-trip', () => {
  it('a proposal + votes ride the EventLog and re-read as a resolvable proposal', async () => {
    const eventLog = new EventLog({ initial: [] });
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'any-admin' } });
    const callSkill = vi.fn(async (origin, op) => {
      if (op === 'listGroupRoster') return { members: [{ addr: 'm1', role: 'member' }] };
      return { ok: true };   // removeMember enactor
    });
    let n = 0;
    const gov = bindCircleGovernance({
      eventLog, callSkill, getPolicy: async () => policy, myRef: 'admin0', genId: () => `p${(n += 1)}`, now: () => 1,
    });
    // admin0 is the sole admin (fallback) → any-admin removeMember enacts immediately
    const r = await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm1', actor: { ref: 'admin0' } });
    expect(r.status).toBe(DECISION_STATUS.APPROVED);
    expect(callSkill).toHaveBeenCalledWith('stoop', 'removeMember', { groupId: 'c1', memberWebid: 'm1', policy: 'graceful' });
    // the propose + resolve entries are in the log, scoped to the circle
    const govEntries = eventLog.query({}).filter((e) => e.type === 'governance' && e.circleId === 'c1');
    expect(govEntries.map((e) => e.payload.event).sort()).toEqual(['propose', 'resolve']);
  });

  it('governance entries are scoped per circle (another circle does not see them)', async () => {
    const eventLog = new EventLog({ initial: [] });
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });
    const callSkill = vi.fn(async (origin, op) => (op === 'listGroupRoster' ? { members: [{ addr: 'm1', role: 'member' }, { addr: 'm2', role: 'member' }] } : { ok: true }));
    let n = 0;
    const gov = bindCircleGovernance({ eventLog, callSkill, getPolicy: async () => policy, myRef: 'admin0', genId: () => `p${(n += 1)}`, now: () => 1 });
    await gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline: 100 });
    const otherCircle = eventLog.query({}).filter((e) => e.type === 'governance' && e.circleId === 'c2');
    expect(otherCircle).toHaveLength(0);
  });
});
