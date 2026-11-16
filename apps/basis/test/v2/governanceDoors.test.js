/**
 * THE MEMBERS PANEL'S REMOVE GOES THROUGH THE CIRCLE'S RULE: any admin may remove → removed at once (with the
 * governance trail); the circle decides together → a proposal opens and nobody is removed yet.
 * Through the real governance host (`makeCircleGovernance`) over an in-memory log.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCircleGovernance } from '../../src/v2/governanceHost.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { removeMemberDoor } from '../../src/v2/governanceDoors.js';

const members = [{ ref: 'a0', role: 'admin' }, { ref: 'a1', role: 'admin' }, { ref: 'm0', role: 'member' }];

function host(governance) {
  const policy = normalizeCirclePolicy({ governance });
  const removed = [];
  const events = [];
  let n = 0;
  const gov = makeCircleGovernance({
    callSkill: vi.fn(async () => ({ ok: true })),
    removeMember: async (circleId, ref) => { removed.push(ref); return { ok: true }; },
    readGovernanceState: async () => ({ events, disputed: new Set() }),
    appendGovernanceEvent: async (_c, e) => { events.push(e); },
    getPolicy: async () => policy, getMembers: async () => members,
    localActorRef: 'a0', newProposalId: () => `p${(n += 1)}`, now: () => 0,
  });
  return { gov, removed, events };
}

describe('the members panel removes through the circle\'s rule', () => {
  it('any admin may remove: removed at once, with the propose + resolve trail', async () => {
    const { gov, removed, events } = host({ removeMember: 'any-admin' });
    const r = await removeMemberDoor({ governance: gov, circleId: 'c1', memberWebid: 'm0', actorRef: 'a0' });
    expect(r.outcome).toBe('done');
    expect(removed).toEqual(['m0']);
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(['propose', 'resolve']));
  });

  it('the admins decide together (two admins): a proposal opens, nobody is removed yet', async () => {
    const { gov, removed } = host({ removeMember: 'admin-quorum' });
    const r = await removeMemberDoor({ governance: gov, circleId: 'c1', memberWebid: 'm0', actorRef: 'a0' });
    expect(r.outcome).toBe('proposed');
    expect(r.proposalId).toBeTruthy();
    expect(removed).toEqual([]);
  });

  it('the whole circle votes: a proposal opens, nobody is removed yet', async () => {
    const { gov, removed } = host({ removeMember: 'member-vote' });
    expect((await removeMemberDoor({ governance: gov, circleId: 'c1', memberWebid: 'm0', actorRef: 'a0' })).outcome).toBe('proposed');
    expect(removed).toEqual([]);
  });

  it('without a governance binding nothing is removed', async () => {
    expect((await removeMemberDoor({ governance: null, circleId: 'c1', memberWebid: 'm0' })).outcome).toBe('refused');
  });
});
