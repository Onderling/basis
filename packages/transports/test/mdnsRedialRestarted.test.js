/**
 * A PEER THAT RESTARTED IS DIALLED AGAIN. When the other device relaunches, its old socket to us can stay mapped until
 * TCP notices it is dead — minutes on a phone. Its new service is discovered, but the dialler side said "already
 * connected" and waited, and the restarted peer (the responder, by the key tiebreak) waited for a dial that never
 * came: the two stayed apart. Now a rediscovery of a peer whose mapped connection has gone silent past the freshness
 * window dials anyway; the proven handshake re-maps it, as an inbound one already did. A live, recently active
 * connection is left alone — a re-announcement is not a reason to open a second socket.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { MdnsTransport } from '../src/MdnsTransport.js';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '../src/mdnsNodeBackend.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 120) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); } return false; };
const ident = async () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());

describe('a restarted peer is dialled again', () => {
  const open = [];
  const FRESH = MdnsTransport.FRESHNESS_MS;
  afterEach(async () => {
    MdnsTransport.FRESHNESS_MS = FRESH;
    for (const t of open.splice(0)) await t.disconnect?.().catch?.(() => {});
  });
  // `late`: this device hears the room only once its own service is up — the order a relaunched phone with Nearby open
  // can have (registered and advertising before its first discovery result). Without it a starting device dials
  // during its own start window (it is not advertising yet, so the key tiebreak does not hold) and heals the
  // restart by itself; with it, it is the RESPONDER and waits, which is the stranded case.
  const device = async (discovery, identity, { late = false } = {}) => {
    const disc = late ? {
      advertise: (r) => discovery.advertise(r),
      browse: (b) => discovery.browse({ ...b, onFound: (x) => setTimeout(() => b.onFound(x), 150) }),
    } : discovery;
    const { native, emitter } = createMdnsNodeBackend({ discovery: disc, host: '127.0.0.1' });
    const t = new MdnsTransport({ identity, native, emitter });
    open.push(t);
    await t.connect();
    return t;
  };
  // A dials (its key sorts lower), B answers — the shape where the restart strands them
  const pair = async () => {
    let a, b;
    do { a = await ident(); b = await ident(); } while (!(a.pubKey < b.pubKey));
    return { a, b };
  };

  it('silent past the freshness window: the restarted peer\'s new service is dialled, and messages reach it', async () => {
    MdnsTransport.FRESHNESS_MS = 150;
    const discovery = createLoopbackDiscovery();
    const { a, b } = await pair();
    const A = await device(discovery, a);
    const B = await device(discovery, b);
    expect(await settle(() => A.canReach(b.pubKey) && B.canReach(a.pubKey)), 'connected').toBe(true);

    await wait(250);                                   // the old socket goes quiet past the window
    const B2 = await device(discovery, b, { late: true });   // B relaunches: same key, a new service; A's old socket still mapped
    expect(await settle(() => B2.canReach(a.pubKey)), 'A dialled the restarted B').toBe(true);

    const got = [];
    B2.on('envelope', (e) => got.push(e));
    await A.sendOneWay(b.pubKey, { after: 'restart' });
    expect(await settle(() => got.length > 0), 'what A sends reaches the B that is running now').toBe(true);
  });

  it('a live, recently active connection is left alone: a re-announcement opens no second socket', async () => {
    MdnsTransport.FRESHNESS_MS = 60_000;
    const discovery = createLoopbackDiscovery();
    const { a, b } = await pair();
    const A = await device(discovery, a);
    const B = await device(discovery, b);
    expect(await settle(() => A.canReach(b.pubKey) && B.canReach(a.pubKey))).toBe(true);
    const B2 = await device(discovery, b, { late: true });   // the same key announced again while A's connection is fresh
    await wait(400);
    expect(B2.canReach(a.pubKey), 'no dial to a fresh, mapped peer').toBe(false);
  });
});
