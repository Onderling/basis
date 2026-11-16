/**
 * MAKING SOMEONE AN ADMIN FOLLOWS THE CIRCLE'S SETTINGS RULE (Frits 2026-11-10: role changes are a governed action
 * under the settings class). Before: any one admin did it alone, whatever the circle's rules, which let one admin
 * outvote the others by adding admins. An admin stepping DOWN from their own role is their own act and never waits.
 * Through the real governance host (`makeCircleGovernance`) over an in-memory log; both shells pinned.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeCircleGovernance } from '../../src/v2/governanceHost.js';
import { normalizeCirclePolicy, decisionClassFor, requiredClassFor } from '../../src/v2/circlePolicy.js';
import { changeRoleDoor } from '../../src/v2/governanceDoors.js';

const members = [{ ref: 'a0', role: 'admin' }, { ref: 'a1', role: 'admin' }, { ref: 'm0', role: 'member' }];

function host(governance) {
  const policy = normalizeCirclePolicy({ governance });
  const events = [];
  let n = 0;
  const callSkill = vi.fn(async (_app, _op, args) => ({ ok: true, ...args, forwarded: true, held: false }));
  const gov = makeCircleGovernance({
    callSkill,
    readGovernanceState: async () => ({ events, disputed: new Set() }),
    appendGovernanceEvent: async (_c, e) => { events.push(e); },
    getPolicy: async () => policy, getMembers: async () => members,
    localActorRef: 'a0', newProposalId: () => `p${(n += 1)}`, now: () => 0,
  });
  return { gov, callSkill, events, policy };
}

describe('a role change is decided by the circle\'s settings class', () => {
  it('the class of changeRole is the class of changePolicy; it is not a setting of its own', () => {
    const p = normalizeCirclePolicy({ governance: { changePolicy: 'member-vote' } });
    expect(decisionClassFor(p, 'changeRole')).toBe('member-vote');
    expect(requiredClassFor(p, 'change-role')).toBe('member-vote');
    expect(Object.keys(p.governance)).not.toContain('changeRole');
  });

  it('any admin decides settings: the member is made admin at once, and the op\'s answer comes back', async () => {
    const { gov, callSkill } = host({ changePolicy: 'any-admin' });
    const r = await changeRoleDoor({ governance: gov, callSkill: vi.fn(), circleId: 'c1', memberWebid: 'm0', role: 'admin', actorRef: 'a0' });
    expect(r.outcome).toBe('done');
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'setMemberRole', { groupId: 'c1', memberWebid: 'm0', role: 'admin', proposalId: expect.any(String) });
    expect(r.result?.forwarded).toBe(true);
  });

  it('the admins decide settings together (two admins): a proposal opens, nobody is made admin yet', async () => {
    const { gov, callSkill } = host({ changePolicy: 'admin-quorum' });
    const r = await changeRoleDoor({ governance: gov, callSkill: vi.fn(), circleId: 'c1', memberWebid: 'm0', role: 'admin', actorRef: 'a0' });
    expect(r.outcome).toBe('proposed');
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('making ANOTHER admin a member again is governed too', async () => {
    const { gov, callSkill } = host({ changePolicy: 'member-vote' });
    const r = await changeRoleDoor({ governance: gov, callSkill: vi.fn(), circleId: 'c1', memberWebid: 'a1', role: 'member', actorRef: 'a0' });
    expect(r.outcome).toBe('proposed');
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('an admin stepping down from their OWN role never waits on a vote', async () => {
    const { gov, callSkill: govSkill } = host({ changePolicy: 'member-vote' });
    const own = vi.fn(async () => ({ ok: true }));
    const r = await changeRoleDoor({ governance: gov, callSkill: own, circleId: 'c1', memberWebid: 'a0', role: 'member', actorRef: 'a0' });
    expect(r.outcome).toBe('done');
    expect(own).toHaveBeenCalledWith('pinboard', 'setMemberRole', { groupId: 'c1', memberWebid: 'a0', role: 'member' });
    expect(govSkill).not.toHaveBeenCalled();
  });

  it('a refused op is refused, with its answer', async () => {
    const r = await changeRoleDoor({ governance: null, callSkill: async () => ({ error: 'admin-only' }), circleId: 'c1', memberWebid: 'a0', role: 'member', actorRef: 'a0' });
    expect(r.outcome).toBe('refused');
    expect((await changeRoleDoor({ governance: null, circleId: 'c1', memberWebid: 'm0', role: 'admin', actorRef: 'a0' })).outcome).toBe('refused');
  });
});

describe('both members panels change roles through the door', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const web = read('../../web/v2/circleApp.js');
  const phone = read('../../../basis-mobile/src/screens/v2/CircleAdminPanelScreen.js');
  const webSet = web.slice(web.indexOf('onSetRole: async (m, control) => {'), web.indexOf('onSetRole: async (m, control) => {') + 1600);
  const phoneSet = phone.slice(phone.indexOf('const setRole = useCallback('), phone.indexOf('const setRole = useCallback(') + 1600);

  it('web', () => {
    expect(webSet).toMatch(/changeRoleDoor\(/);
    expect(webSet).not.toMatch(/'setMemberRole'/);
  });

  it('phone', () => {
    expect(phoneSet).toMatch(/changeRoleDoor\(/);
    expect(phoneSet).not.toMatch(/'setMemberRole'/);
  });
});

describe('the proposals list names who a proposal is about, never an object as text', async () => {
  const { buildGovernanceView } = await import('../../src/v2/governanceView.js');
  const fold = { proposals: [
    { proposalId: 'p1', action: 'changeRole', subject: { member: 'm0', role: 'admin' }, status: 'pending', votes: [] },
    { proposalId: 'p2', action: 'changeRule', subject: { purpose: 'x' }, status: 'pending', votes: [] },
    { proposalId: 'p3', action: 'removeMember', subject: 'm0', status: 'pending', votes: [] },
  ] };
  const view = buildGovernanceView({ fold, viewer: { ref: 'a0', role: 'admin' }, labelForSubject: (s) => (s === 'm0' ? 'Bram' : String(s)) });
  const label = (id) => [...view.open, ...view.closed].find((r) => r.proposalId === id)?.subjectLabel;
  it('a role change names its member; a rules change has no subject line; a removal names its member', () => {
    expect(label('p1')).toBe('Bram');
    expect(label('p2')).toBe('');
    expect(label('p3')).toBe('Bram');
  });
});
