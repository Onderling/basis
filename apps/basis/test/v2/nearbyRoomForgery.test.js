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
    const device = async (name, onPeerMessage = null) => {
      const sa = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, ...(onPeerMessage ? { onPeerMessage } : {}) });
      cleanups.push(() => sa.shutdown());
      const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
      // the full chat identity (it signs the LAN handshake) — what the mobile bundle builds its mDNS from
      const mdns = new MdnsTransport({ identity: sa.agent.identity, native, emitter });
      await sa.addSecureTransport('mdns', mdns);
      return { name, sa, mdns, key: sa.identity.pubKey };
    };

    // T, with the real room binding fed from its secure agent's inbound — what the shells' peer routers do
    let room = null;
    const T = await device('T', ({ from, payload }) => { room?.onPeerMessage(from, payload); });
    const A = await device('A');
    const M = await device('M');
    room = createNearbyRoomBinding({
      sendPeerMessage: (addr, payload) => T.sa.peer.sendTo(addr, payload),
      listPeers: () => [A, M].filter((d) => T.mdns.canReach(d.key)).map((d) => ({ pubKey: d.key })),
      myAddress: () => T.key,
    });
    expect(await until(() => T.mdns.canReach(A.key) && T.mdns.canReach(M.key) && M.mdns.canReach(T.key)), 'all three on the LAN').toBe(true);

    // M re-addresses its own transport as A: its agent now signs (with M's key) and stamps `from A` — over M's socket
    M.mdns._setAddress(A.key);
    await M.sa.peer.sendTo(T.key, { subtype: 'nearby-presence', presence: { label: 'Ada (forged)' } }, { firstSendTimeoutMs: 800, retryDelays: [] }).catch(() => {});
    await wait(300);

    // behaviour first: what the room heard, and whose key A's address now holds
    expect(room.presenceOf(A.key), 'the room never heard "A" from M').toBeNull();
    const heldForA = T.sa.agent.security.getPeerKey(A.key);
    expect(heldForA === M.key, 'nobody rebinds: A\'s address is never M\'s key').toBe(false);
    expect(T.mdns.refusedSenders, 'dropped and counted at the LAN').toBeGreaterThan(0);

    // A, honest, speaks for itself — and is heard
    await A.sa.peer.sendTo(T.key, { subtype: 'nearby-presence', presence: { label: 'Ada' } });
    expect(await until(() => room.presenceOf(A.key)?.label === 'Ada'), 'A\'s own word reaches the room').toBe(true);
    expect(T.sa.agent.security.getPeerKey(A.key), 'A\'s address holds A\'s key').toBe(A.key);
  }, 30_000);
});
