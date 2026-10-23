/**
 * THE LAN/RELAY HYBRID, both ways, with the relay up. Two secure agents share a real relay (in-process) AND a LAN
 * link that behaves the way the mDNS transport does: it routes to a peer only while that peer is connected (`canReach`
 * is the socket), a send to a peer that has gone fails like a closed socket, and it announces `peer-discovered` /
 * `peer-disconnected`. The secure send path's own picker and failover decide; this test only moves the peer:
 *
 *   on the LAN            → sends ride the LAN
 *   leaves (announced)    → sends ride the relay
 *   leaves mid-send       → the LAN send fails, the failover resends on the relay — the message arrives once
 *   comes back            → sends ride the LAN again
 *
 * and across all of it no message is lost and none arrives twice.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

/**
 * The LAN between two devices: one bus; whether they are both on it (`present`, the truth) and whether the transports
 * have NOTICED (`known` — what `canReach` reads, as MdnsTransport's connected-peer map does until the socket's close
 * arrives). Leaving unannounced is the gap a real phone has: the socket is gone, the transport still believes.
 */
function makeLan() {
  const bus = new InternalBus();
  const ends = new Set();
  const lan = {
    bus, present: true, known: true,
    leave({ announce = true } = {}) {
      lan.present = false;
      if (announce) { lan.known = false; for (const e of ends) e.announce('peer-disconnected'); }
    },
    join() { lan.present = true; lan.known = true; for (const e of ends) e.announce('peer-discovered'); },
    ends,
  };
  return lan;
}

/** One device's end of the LAN — honest the way MdnsTransport is: reachable = connected now; gone = a closed socket. */
class LanTransport extends InternalTransport {
  constructor(lan, address, identity) {
    super(lan.bus, address, { identity });
    this.lan = lan;
    this.carried = 0;
    lan.ends.add(this);
  }
  canReach(peer) { return this.lan.known && [...this.lan.ends].some((e) => e !== this && e.address === peer); }
  announce(event) { for (const e of this.lan.ends) if (e !== this) this.emit(event, e.address); }
  async _put(to, envelope) {
    if (!this.lan.present) throw new Error('ECONNRESET: mDNS socket closed (peer left the LAN)');
    this.carried += 1;
    return super._put(to, envelope);
  }
}

async function twoDevices() {
  const relay = await startRelay({ port: 0, log: false });
  cleanups.push(() => relay.stop());
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const lan = makeLan();
  const got = { a: [], b: [] };
  const device = async (key) => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000,
      onPeerMessage: ({ payload }) => { if (payload?.type === 'hybrid') got[key].push(payload.n); },
    });
    cleanups.push(() => sa.shutdown());
    await sa.relay.connect({ relayUrl, awaitReady: true });
    const lanEnd = new LanTransport(lan, sa.identity.pubKey, sa.identity);
    await sa.addSecureTransport('mdns', lanEnd);
    return { sa, lanEnd };
  };
  const A = await device('a');
  const B = await device('b');
  return { A, B, lan, got };
}

const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return fn(); };
const routeName = async (sa, peer) => (await sa.agent.routing.selectTransport(peer))?.name ?? null;

describe('LAN ⇄ relay, both ways, with the relay up', () => {
  it('rides the LAN while the peer is on it, the relay when it leaves, the LAN again when it is back — nothing lost, nothing twice', async () => {
    const { A, B, lan, got } = await twoDevices();
    const peer = B.sa.identity.pubKey;
    const send = (n) => A.sa.peer.sendTo(peer, { type: 'hybrid', n });
    let n = 0;

    // on the LAN
    expect(await routeName(A.sa, peer)).toBe('mdns');
    for (let i = 0; i < 3; i++) await send(++n);
    expect(A.lanEnd.carried, 'the LAN carried them').toBeGreaterThanOrEqual(3);

    // leaves, announced: the picker drops to the relay
    lan.leave();
    expect(await routeName(A.sa, peer)).toBe('relay');
    const lanBefore = A.lanEnd.carried;
    for (let i = 0; i < 3; i++) await send(++n);
    expect(A.lanEnd.carried, 'nothing more on the LAN while the peer is away').toBe(lanBefore);

    // back: the picker returns to the LAN
    lan.join();
    expect(await routeName(A.sa, peer), 'back on the LAN, the LAN again').toBe('mdns');
    for (let i = 0; i < 3; i++) await send(++n);
    expect(A.lanEnd.carried, 'the LAN carries again').toBeGreaterThan(lanBefore);

    await until(() => got.b.length >= n);
    // every message exactly once. NOT in send order: a one-way send promises no order across transports — what rode
    // the relay can land after what rode the LAN later (measured: [1,2,3,7,8,9,4,5,6]); order is the app's, by time.
    expect([...got.b].sort((x, y) => x - y), 'every message, exactly once').toEqual(Array.from({ length: n }, (_, i) => i + 1));
  }, 30_000);

  it('leaves MID-SEND (not yet announced): the LAN send fails, the failover resends on the relay — it arrives once; back, the LAN is used again', async () => {
    const { A, B, lan, got } = await twoDevices();
    const peer = B.sa.identity.pubKey;
    const send = (n) => A.sa.peer.sendTo(peer, { type: 'hybrid', n });
    await send(1);                       // first contact over the LAN
    lan.leave({ announce: false });      // the socket dies before anyone says so
    expect(await routeName(A.sa, peer), 'the transport still believes the peer is there').toBe('mdns');
    await send(2);                       // picked the LAN, failed like a closed socket, failed over
    expect(A.sa.agent.routing.fallbackTable.isDegraded(peer, 'mdns'), 'the failover marked the LAN').toBe(true);
    await send(3);
    lan.join();
    expect(await routeName(A.sa, peer), 'a peer back on the LAN is routed there again, not after a 30 s penalty').toBe('mdns');
    const before = A.lanEnd.carried;
    await send(4);
    expect(A.lanEnd.carried, 'message 4 rode the LAN').toBeGreaterThan(before);
    await until(() => got.b.length >= 4);
    expect([...got.b].sort((x, y) => x - y), 'every message, exactly once').toEqual([1, 2, 3, 4]);
  }, 30_000);
});
