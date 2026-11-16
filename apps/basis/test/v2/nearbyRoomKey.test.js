/**
 * The Nearby room key's lifecycle: a fresh key per entry, registered as the self's, spoken on the LAN; forgotten and
 * back to a rest key only when the view is closed AND the room is empty.
 */
import { describe, it, expect } from 'vitest';
import { createNearbyRoomKey } from '../../src/v2/nearbyRoomKey.js';

function harness({ self = { id: 'werk' } } = {}) {
  const calls = { identityFor: [], registered: new Map(), forgotten: [], lan: [] };
  let peers = [];
  let peerWatcher = null;
  let current = self;
  let n = 0;
  const key = createNearbyRoomKey({
    roomSelf: () => current,
    identityFor: async (selfId, ns) => { calls.identityFor.push({ selfId, ns }); n += 1; return { pubKey: `room-${selfId}-${n}` }; },
    ownerOf: (selfId) => `chat-${selfId}`,
    registerSelfIdentity: (address, identity, o) => { calls.registered.set(address, { identity, owner: o?.owner ?? null }); return true; },
    forgetSelfIdentity: (address) => { calls.forgotten.push(address); calls.registered.delete(address); return true; },
    setLanIdentity: async (identity) => { calls.lan.push(identity?.pubKey ?? null); return identity?.pubKey ?? 'rest'; },
    listPeers: () => peers,
    subscribeToPeers: (fn) => { peerWatcher = fn; return () => {}; },
  });
  return {
    key, calls,
    setPeers(p) { peers = p; peerWatcher?.(p); },
    setSelf(s) { current = s; },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the Nearby room key', () => {
  it('opening the view enters as the room self under a fresh key, registered as that self\'s, spoken on the LAN', async () => {
    const h = harness();
    await h.key.viewOpened();
    expect(h.key.address()).toBe('room-werk-1');
    expect(h.calls.identityFor[0].selfId).toBe('werk');
    expect(h.calls.identityFor[0].ns).toMatch(/^nearby:[0-9a-f]{32}$/);
    expect(h.calls.registered.get('room-werk-1').owner, 'owned by the self (its chat key)').toBe('chat-werk');
    expect(h.calls.lan).toEqual(['room-werk-1']);
  });

  it('two entries are two keys under two namespaces: the room never sees the same key twice', async () => {
    const h = harness();
    await h.key.viewOpened(); await h.key.viewClosed();
    await h.key.viewOpened();
    expect(h.key.address()).toBe('room-werk-2');
    expect(h.calls.identityFor[0].ns).not.toBe(h.calls.identityFor[1].ns);
  });

  it('closing the view with people still in the room keeps the key; the room emptying then leaves', async () => {
    const h = harness();
    await h.key.viewOpened();
    h.setPeers([{ pubKey: 'someone' }]);
    await h.key.viewClosed();
    expect(h.key.address(), 'the room outlives the screen').toBe('room-werk-1');
    h.setPeers([]);
    await settle(); await settle();
    expect(h.key.address()).toBeNull();
    expect(h.calls.forgotten).toEqual(['room-werk-1']);
    expect(h.calls.lan.at(-1), 'back to a rest key').toBeNull();
  });

  it('a room still asking which self enters nobody; a self switch re-enters as the new self', async () => {
    const h = harness({ self: { asking: true } });
    await h.key.viewOpened();
    expect(h.key.address()).toBeNull();
    expect(h.calls.identityFor).toEqual([]);
    h.setSelf({ id: 'jij' });
    await h.key.selfChanged();
    expect(h.key.address()).toBe('room-jij-1');
    h.setSelf({ id: 'werk' });
    await h.key.selfChanged();
    expect(h.key.address()).toBe('room-werk-2');
    expect(h.calls.forgotten).toEqual(['room-jij-1']);
  });

  it('no room self chosen (one self on the device) enters as the default', async () => {
    const h = harness({ self: null });
    await h.key.viewOpened();
    expect(h.calls.identityFor[0].selfId).toBe('default');
  });
});
