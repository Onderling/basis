/**
 * The Node mDNS backend — framing first, then the whole transport over real sockets.
 *
 * The framing tests are not ceremony: a length-prefixed stream that is wrong does not throw, it
 * desynchronises, and the symptom appears much later as "the phone and the laptop never see each other".
 * So the adversarial chunkings are asserted directly rather than inferred from a happy-path round trip.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { MdnsTransport } from '../src/MdnsTransport.js';
import {
  createMdnsNodeBackend, createLoopbackDiscovery, createFrameReader, frameEncode,
} from '../src/mdnsNodeBackend.js';

// Local throwaway vault — the convention in this package's tests (@onderling/vault is not linked here).
const throwawayVault = () => {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 60) => {
  for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); }
  return false;
};

describe('framing — 4-byte big-endian length prefix', () => {
  const collect = () => { const out = []; return { out, push: createFrameReader((b) => out.push(b.toString())) }; };

  it('reads one whole frame', () => {
    const { out, push } = collect();
    push(frameEncode(Buffer.from('hello')));
    expect(out).toEqual(['hello']);
  });

  it('reads SEVERAL frames delivered in one chunk', () => {
    const { out, push } = collect();
    push(Buffer.concat([frameEncode(Buffer.from('a')), frameEncode(Buffer.from('bb')), frameEncode(Buffer.from('ccc'))]));
    expect(out).toEqual(['a', 'bb', 'ccc']);
  });

  it('reassembles a frame split across chunks — including mid-header', () => {
    const { out, push } = collect();
    const framed = frameEncode(Buffer.from('split me'));
    push(framed.subarray(0, 2));      // half the length prefix
    expect(out).toEqual([]);
    push(framed.subarray(2, 6));      // rest of prefix + a little body
    expect(out).toEqual([]);
    push(framed.subarray(6));
    expect(out).toEqual(['split me']);
  });

  it('survives a frame arriving one byte at a time', () => {
    const { out, push } = collect();
    const framed = frameEncode(Buffer.from('drip'));
    for (const b of framed) push(Buffer.from([b]));
    expect(out).toEqual(['drip']);
  });

  it('handles an empty frame without stalling the stream', () => {
    const { out, push } = collect();
    push(Buffer.concat([frameEncode(Buffer.alloc(0)), frameEncode(Buffer.from('after'))]));
    expect(out).toEqual(['', 'after']);
  });
});

describe('two Node transports over real sockets', () => {
  const open = [];
  afterEach(async () => { for (const t of open.splice(0)) await t.disconnect().catch(() => {}); });

  async function peer(discovery) {
    const identity = await AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
    const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const t = new MdnsTransport({ identity, native, emitter });
    open.push(t);
    return { identity, transport: t };
  }

  it('discover each other, apply the tiebreaker, and exchange an envelope', async () => {
    const discovery = createLoopbackDiscovery();
    const a = await peer(discovery);
    const b = await peer(discovery);

    const aSaw = []; const bSaw = [];
    a.transport.on('peer-discovered', (k) => aSaw.push(k));
    b.transport.on('peer-discovered', (k) => bSaw.push(k));
    const received = [];
    b.transport.on('envelope', (env) => received.push(env));

    await a.transport.connect();
    await b.transport.connect();

    expect(await settle(() => aSaw.includes(b.identity.pubKey) && bSaw.includes(a.identity.pubKey))).toBe(true);

    // Exactly ONE socket, not two: the tiebreaker is the reason this is worth asserting — both peers see
    // each other at the same instant, and only the lower pubKey may initiate.
    expect(a.transport.connectionCount).toBe(1);
    expect(b.transport.connectionCount).toBe(1);

    await a.transport.sendOneWay(b.identity.pubKey, { hello: 'from a', n: 1 });
    expect(await settle(() => received.length > 0)).toBe(true);
    expect(received[0]).toMatchObject({ payload: { hello: 'from a', n: 1 } });
  });

  // Sized just under the kernel's 256 KiB wire limit (`envelopeExceedsLimit`) — big enough that TCP
  // certainly splits it across reads, which is the thing being tested, without pretending the limit
  // is not there.
  it('a large payload survives the stream (framing under real TCP chunking)', async () => {
    const discovery = createLoopbackDiscovery();
    const a = await peer(discovery);
    const b = await peer(discovery);
    const got = [];
    b.transport.on('envelope', (env) => got.push(env));

    await a.transport.connect();
    await b.transport.connect();
    // Assert the precondition rather than branching on it — a conditional here would let the test pass by
    // sending nothing, which is exactly the shape that hides a broken framing change.
    expect(await settle(() => a.transport.connectionCount === 1 && b.transport.connectionCount === 1)).toBe(true);

    await a.transport.sendOneWay(b.identity.pubKey, { blob: 'x'.repeat(200_000) });
    expect(await settle(() => got.length > 0, 200)).toBe(true);
    expect(got[0].payload.blob.length).toBe(200_000);
  });

  it('browse-only keeps the listening socket — going unlisted is not going offline', async () => {
    const discovery = createLoopbackDiscovery();
    const a = await peer(discovery);
    await a.transport.connect();
    expect(a.transport.isAdvertising).toBe(true);

    const state = await a.transport._applyDiscoverability('browse');
    expect(state).toBe('browse');
    expect(a.transport.isAdvertising).toBe(false);

    // Still reachable: a peer that already knows the port can still connect.
    const b = await peer(discovery);
    await b.transport.connect();
    const seen = [];
    a.transport.on('peer-discovered', (k) => seen.push(k));
    expect(await settle(() => seen.includes(b.identity.pubKey))).toBe(true);
  });
});
