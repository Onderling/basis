/**
 * feedHouseholdRoster — turn a circle's member roster into no-pod household-sync peers.
 */
import { describe, it, expect, vi } from 'vitest';
import { feedHouseholdRoster, bindCircleAddressKeysFor, makeCircleReachable } from '../../src/v2/householdRosterPairing.js';

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

describe('bindCircleAddressKeysFor — the peer → kringen index is complete at boot (2026-09-08)', () => {
  // Why this lives here and not in the screen that opens a kring: the index decides which relay a DIRECT
  // message takes, and a DM is sent from Contacten, which nobody has to visit a kring to reach. Filled
  // only on circle-open, the map was empty exactly when someone starts the app and messages a person.
  function mkIndexAgent(members) {
    const edges = [];
    return {
      edges,
      identity: { pubKey: 'me' },
      registerPeerAddress: () => {},
      callSkill: async (_app, op) => (op === 'listGroupMembers' ? { members } : {}),
      _circleGroupsIndex: { add: (circleId, webid) => edges.push([circleId, webid]) },
    };
  }

  it('records every member of the circle it just read, from that same read', async () => {
    const agent = mkIndexAgent([{ addr: 'anna' }, { addr: 'bram' }, { addr: 'me' }]);
    await bindCircleAddressKeysFor({ agent, circleId: 'k1' });
    expect(agent.edges).toEqual([['k1', 'anna'], ['k1', 'bram'], ['k1', 'me']]);
  });

  it('a member known by a PER-CIRCLE address is indexed under their global key as well — a DM is sent to that', async () => {
    // The 2026-09-08 fill recorded only `addr`, which is the per-circle address once a member has proven
    // one — every member after their first boot. So the index knew Anna only by an address a direct
    // message never uses, `circlesForPeer(annaGlobal)` found nothing, and the DM went to my own relay
    // instead of the kring's. The three-run browser measurement (2026-09-13) hit exactly when the DM
    // raced ahead of Anna's announce and missed otherwise.
    const agent = mkIndexAgent([
      { addr: 'relay:anna.k1', webid: 'anna-global', pubKey: 'anna-global' },   // proven per-circle address
      { addr: 'bram-global',   webid: 'bram-global', pubKey: 'bram-global' },   // not yet — addr IS the global key
    ]);
    await bindCircleAddressKeysFor({ agent, circleId: 'k1' });
    const keysFor = (who) => agent.edges.filter(([, k]) => k.includes(who)).map(([, k]) => k);
    expect(keysFor('anna'), 'Anna must be findable by the key a DM is addressed to').toContain('anna-global');
    expect(keysFor('anna'), '…and by the address her circle traffic arrives from').toContain('relay:anna.k1');
    expect(keysFor('bram'), 'one key, recorded once').toEqual(['bram-global']);
  });

  it('a shell with no index, and a member row with no address, are both no-ops', async () => {
    const agent = mkIndexAgent([{ addr: 'anna' }, { name: 'no address' }]);
    await bindCircleAddressKeysFor({ agent, circleId: 'k1' });
    expect(agent.edges).toEqual([['k1', 'anna']]);
    const bare = { identity: { pubKey: 'me' }, registerPeerAddress: () => {}, callSkill: async () => ({ members: [{ addr: 'anna' }] }) };
    await expect(bindCircleAddressKeysFor({ agent: bare, circleId: 'k1' })).resolves.toBeTruthy();
  });

  it('an index that throws never breaks priming — the circle still binds', async () => {
    const agent = mkIndexAgent([{ addr: 'anna' }]);
    agent._circleGroupsIndex = { add: () => { throw new Error('boom'); } };
    await expect(bindCircleAddressKeysFor({ agent, circleId: 'k1' })).resolves.toMatchObject({ members: [{ addr: 'anna' }] });
  });
});

describe('makeCircleReachable — a fresh joiner PULLS the circle\'s lanes (2026-09-16)', () => {
  const mk = () => ({
    identity: { pubKey: 'me' },
    registerPeerAddress: () => {},
    callSkill: async (_app, op) => (op === 'listGroupMembers' ? { members: [{ addr: 'anna' }] } : {}),
    _circleGroupsIndex: { add: () => {} },
  });
  it('runs the host\'s pull seam for the circle AFTER registering and binding, and reports it', async () => {
    const order = [];
    const r = await makeCircleReachable({
      agent: mk(), circleId: 'k1',
      registerCirclePresence: async () => { order.push('register'); },
      pullLanes: async (cid) => { order.push(`pull:${cid}`); },
    });
    expect(order).toEqual(['register', 'pull:k1']);
    expect(r).toMatchObject({ registered: true, pulled: true });
  });
  it('a pull that fails costs the join nothing — stated, not swallowed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await makeCircleReachable({ agent: mk(), circleId: 'k1', pullLanes: async () => { throw new Error('no peer'); } });
    expect(r.pulled).toBe(false);
    expect(warn.mock.calls.some(([m]) => /could not pull its lanes/.test(String(m)))).toBe(true);
    warn.mockRestore();
  });
  it('without a pull seam nothing is pulled and nothing breaks (a host from before)', async () => {
    expect((await makeCircleReachable({ agent: mk(), circleId: 'k1' })).pulled).toBe(false);
  });
});
