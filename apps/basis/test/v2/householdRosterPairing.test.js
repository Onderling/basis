/**
 * feedHouseholdRoster — turn a circle's member roster into no-pod household-sync peers.
 */
import { describe, it, expect, vi } from 'vitest';
import { feedHouseholdRoster } from '../../src/v2/householdRosterPairing.js';

function mkAgent({ members = [], selfAddr = 'me', skill, paired = [] } = {}) {
  const added = [];
  const removed = [];
  const current = new Set(paired);
  return {
    added,
    removed,
    peer: { address: selfAddr },
    // Peer ops are per-circle since a77371cd: addCirclePeer(circleId, pubKey). Capture the peer, not the circle.
    addCirclePeer: (_circleId, addr) => { added.push(addr); current.add(addr); },
    listCirclePeers: async () => [...current],
    removeHouseholdPeer: async (_circleId, addr) => { removed.push(addr); current.delete(addr); },
    callSkill: skill ?? vi.fn(async (app, op) => (op === 'listGroupRoster' ? { members } : {})),
  };
}

describe('feedHouseholdRoster', () => {
  it('adds every member except self as a household peer', async () => {
    const agent = mkAgent({ members: [{ addr: 'me' }, { addr: 'laptop' }, { addr: 'phone2' }], selfAddr: 'me' });
    const n = await feedHouseholdRoster({ agent, circleId: 'c1' });
    expect(n).toBe(2);
    expect(agent.added).toEqual(['laptop', 'phone2']);
  });

  it('no-ops without an agent / addCirclePeer / circleId', async () => {
    expect(await feedHouseholdRoster({})).toBe(0);
    expect(await feedHouseholdRoster({ agent: { addCirclePeer: () => {} } })).toBe(0); // no circleId
    expect(await feedHouseholdRoster({ agent: { callSkill: () => {} }, circleId: 'c' })).toBe(0); // no addCirclePeer
  });

  // The RECEIVE half of a removal. Pairing used to only ever add, so the fan-out list could not
  // shrink and a removed member went on being sent everything the circle published. Each device has
  // to do this for itself: the removal happens on one admin's device, and only every other member
  // reading the circle's own record can stop their own fan.
  it('unpairs whoever the roster no longer names', async () => {
    const agent = mkAgent({
      members:  [{ addr: 'laptop' }, { addr: 'phone2' }],   // `bram` is gone from the roster
      selfAddr: 'me',
      paired:   ['laptop', 'phone2', 'bram'],
    });
    await feedHouseholdRoster({ agent, circleId: 'c1' });
    expect(agent.removed).toEqual(['bram']);
    expect(await agent.listCirclePeers('c1')).toEqual(['laptop', 'phone2']);
  });

  it('never unpairs on an EMPTY roster — that is a failed read, not an empty circle', async () => {
    // The house rule `recordCircleRoster` states, for exactly this hazard: acting on an empty read
    // would unpair a healthy circle every time a skill call happened to fail.
    const agent = mkAgent({ members: [], selfAddr: 'me', paired: ['laptop', 'phone2'] });
    await feedHouseholdRoster({ agent, circleId: 'c1' });
    expect(agent.removed).toEqual([]);
  });

  it('leaves self alone even when the roster omits it (listGroupRoster excludes the caller)', async () => {
    const agent = mkAgent({ members: [{ addr: 'laptop' }], selfAddr: 'me', paired: ['me', 'laptop'] });
    await feedHouseholdRoster({ agent, circleId: 'c1' });
    expect(agent.removed).toEqual([]);
  });

  it('stays local when the roster lookup throws (not a group / no roster)', async () => {
    const agent = mkAgent({ skill: vi.fn(async () => { throw new Error('no roster'); }) });
    expect(await feedHouseholdRoster({ agent, circleId: 'c' })).toBe(0);
    expect(agent.added).toEqual([]);
  });
});
