/**
 * THE NEARBY ROOM, AGAINST A NEIGHBOUR WHO FORGES. Three devices on one LAN over the real mDNS transport (loopback
 * sockets, the challenged hello), each a real secure agent, the target running the real room binding:
 *
 *   A — the person on the Wi-Fi,
 *   M — an honest device on the same Wi-Fi (its own key, proven on its own socket) that sends AS A: its agent signs a
 *       normal hello and a room message with its own key and stamps them `from A`, over its own proven connection,
 *   T — the room, listing both.
 *
 * A room peer is a key proven on a live LAN connection, and the wire `from` must BE that key. So T drops M's frames
 * at the transport (counted, reported), the room never hears "A" from M, and T never binds A's address to M's key —
 * nobody rebinds. A's own honest word still arrives.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { MdnsTransport } from '@onderling/transports/mdns';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '@onderling/transports/mdns-node';
import { createSecureAgent } from '@onderling/secure-agent';
import { createNearbyRoomBinding } from '../../src/v2/nearbyRoomBinding.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(25); } return !!(await fn()); };

describe('the Nearby room against a forging neighbour', () => {
  const cleanups = [];
  afterAll(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

  it('M speaking as A is dropped at the LAN, counted, never reaches the room, and rebinds nobody; A still speaks', async () => {
    const discovery = createLoopbackDiscovery();
    // M is a MODIFIED build: it carries whatever its agent hands it (our own outbound rule skipped)
    class Forger extends MdnsTransport { _mayCarry() { return true; } }
    const device = async (name, onPeerMessage = null, Kind = MdnsTransport) => {
      const sa = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, ...(onPeerMessage ? { onPeerMessage } : {}) });
      cleanups.push(() => sa.shutdown());
      // in the room: the LAN speaks the room key, registered as one of the agent's identities (nearbyRoomKey.js)
      const roomId = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), new VaultMemory());
      const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
      const mdns = new Kind({ identity: sa.agent.identity, lanIdentity: roomId, native, emitter });
      sa.registerSelfIdentity(roomId.pubKey, roomId);
      await sa.addSecureTransport('mdns', mdns);
      return { name, sa, mdns, key: roomId.pubKey, canonical: sa.identity.pubKey };
    };

    // T, with the real room binding fed from its secure agent's inbound — what the shells' peer routers do
    let room = null;
    const T = await device('T', ({ from, payload }) => { room?.onPeerMessage(from, payload); });
    const A = await device('A');
    const M = await device('M', null, Forger);
    const heardOnTheLan = [];   // every envelope T's LAN connection opened, from anyone
    T.mdns.on('envelope', (e) => heardOnTheLan.push(JSON.stringify(e)));
    room = createNearbyRoomBinding({
      sendPeerMessage: (addr, payload, opts) => T.sa.peer.sendTo(addr, payload, opts),
      listPeers: () => [A, M].filter((d) => T.mdns.canReach(d.key)).map((d) => ({ pubKey: d.key })),
      myAddress: () => T.key,
    });
    expect(await until(() => T.mdns.canReach(A.key) && T.mdns.canReach(M.key) && M.mdns.canReach(T.key)), 'all three on the LAN').toBe(true);

    // M re-addresses its own transport as A's room key: its agent signs (with M's key) and stamps `from A` — over M's socket
    M.mdns._setAddress(A.key);
    await M.sa.peer.sendTo(T.key, { subtype: 'nearby-presence', presence: { label: 'Ada (forged)' } }, { firstSendTimeoutMs: 800, retryDelays: [] }).catch(() => {});
    await wait(300);

    // behaviour first: what the room heard, and whose key A's address now holds
    expect(room.presenceOf(A.key), 'the room never heard "A" from M').toBeNull();
    const heldForA = T.sa.agent.security.getPeerKey(A.key);
    expect(heldForA === M.canonical, 'nobody rebinds: A\'s address is never M\'s key').toBe(false);
    expect(T.mdns.refusedSenders, 'dropped and counted at the LAN').toBeGreaterThan(0);

    // A, honest, speaks for itself AS its room key — and is heard
    await A.sa.peer.sendTo(T.key, { subtype: 'nearby-presence', presence: { label: 'Ada' } }, { sendAs: A.key });
    expect(await until(() => room.presenceOf(A.key)?.label === 'Ada'), 'A\'s own word reaches the room').toBe(true);
    expect(T.sa.agent.security.getPeerKey(A.key), 'A\'s address holds A\'s room key').toBe(A.key);

    // and nothing T's LAN connection opened names A's or T's canonical key: the room sees room keys only
    expect(heardOnTheLan.length).toBeGreaterThan(0);
    for (const e of heardOnTheLan) {
      expect(e.includes(A.canonical), 'no canonical key of A in what the room received').toBe(false);
      expect(e.includes(T.canonical), 'nor T\'s own').toBe(false);
    }
  }, 30_000);
});
