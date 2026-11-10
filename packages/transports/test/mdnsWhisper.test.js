/**
 * THE WHISPER: known people find each other on a LAN that carries only LAN keys. After the bound hello, each side
 * sends a fixed number of tags, one per secret it holds (HMAC over the connection's transcript), padded with random
 * fillers. A shared secret gives a matching tag on both sides; a stranger sees random values that change with every
 * connection. A match is recognition, not authorisation: the matched side then signs the transcript with the address
 * it claims, the other side checks that proof AND asks its own rule (a device map, a contact row) before the address
 * is bound to the connection. Only then does the connection carry traffic for that address.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, DISCOVERABILITY } from '@onderling/core';
import { MdnsTransport, WHISPER_SLOTS } from '../src/MdnsTransport.js';
import { whisperTag } from '../src/mdnsChannel.js';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '../src/mdnsNodeBackend.js';
import { b64Encode } from '../src/utils/base64.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 160) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); } return false; };
const ident = async () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
const sigB64 = (bytes) => b64Encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

/** A secret this device holds, the address it proves when the secret matches, and its rule for the other's address. */
const holding = (secret, me, accept = () => true) => ({
  secret, address: me.pubKey, sign: (message) => sigB64(me.sign(message)), accept: async (address) => accept(address),
});

describe('the whisper', () => {
  const open = [];
  afterEach(async () => { for (const t of open.splice(0)) await t.disconnect?.().catch?.(() => {}); });
  const device = async (discovery, secrets = []) => {
    const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const t = new MdnsTransport({ identity: await ident(), native, emitter });
    t.useWhisper(async () => secrets);
    open.push(t);
    return t;
  };

  it('two devices sharing a secret match both ways; each binds the other\'s proven address; traffic for it crosses', async () => {
    const discovery = createLoopbackDiscovery();
    const shared = new Uint8Array(randomBytes(32));
    const a = await ident(); const b = await ident();
    const A = await device(discovery, [holding(shared, a, (x) => x === b.pubKey)]);
    const B = await device(discovery, [holding(shared, b, (x) => x === a.pubKey)]);
    await B.setDiscoverability(DISCOVERABILITY.PUBLISH);
    await A.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(await settle(() => A.canReach(b.pubKey) && B.canReach(a.pubKey)), 'bound both ways').toBe(true);
    expect(A.connectedPeers(), 'the room list still shows LAN keys only').toEqual([B.lanAddress]);
    const got = [];
    B.on('envelope', (e) => got.push(e));
    await A.sendOneWay(b.pubKey, { hi: 'sibling' }, { from: a.pubKey });
    expect(await settle(() => got.some((e) => e.payload?.hi === 'sibling' || e.hi === 'sibling')), 'sent as the bound address, arrived').toBe(true);
  });

  it('a stranger matches nothing, receives exactly the slot count of tags, and binds nothing', async () => {
    const discovery = createLoopbackDiscovery();
    const a = await ident();
    const A = await device(discovery, [holding(new Uint8Array(randomBytes(32)), a)]);
    const C = await device(discovery, []);
    const seen = [];
    C.on('whisper', (tags) => seen.push(tags));
    await C.setDiscoverability(DISCOVERABILITY.PUBLISH);
    await A.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(await settle(() => seen.length > 0), 'C heard A\'s whisper').toBe(true);
    expect(seen[0]).toHaveLength(WHISPER_SLOTS);
    await wait(200);
    expect(C.canReach(a.pubKey)).toBe(false);
  });

  it('a revoked sibling still holding the old secret matches, but its proof is refused by the rule: no binding', async () => {
    const discovery = createLoopbackDiscovery();
    const shared = new Uint8Array(randomBytes(32));
    const a = await ident(); const revoked = await ident();
    const A = await device(discovery, [holding(shared, a, () => false)]);   // the device map says: tombstoned
    const R = await device(discovery, [holding(shared, revoked, () => true)]);
    await R.setDiscoverability(DISCOVERABILITY.PUBLISH);
    await A.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(await settle(() => R.canReach(a.pubKey)), 'R binds A (its own rule allows)').toBe(true);
    await wait(200);
    expect(A.canReach(revoked.pubKey), 'A never binds the revoked device').toBe(false);
  });

  it('tags are bound to the connection: the same secret gives unrelated tags on two transcripts', () => {
    const s = new Uint8Array(randomBytes(32));
    const H1 = new Uint8Array(randomBytes(32)); const H2 = new Uint8Array(randomBytes(32));
    expect(whisperTag(s, H1)).not.toBe(whisperTag(s, H2));
    expect(whisperTag(s, H1)).toBe(whisperTag(s, H1));
  });

  it('a bound address is spoken only on the connection where it was proven', async () => {
    const discovery = createLoopbackDiscovery();
    const shared = new Uint8Array(randomBytes(32));
    const a = await ident(); const b = await ident();
    const A = await device(discovery, [holding(shared, a)]);
    const B = await device(discovery, [holding(shared, b)]);
    const C = await device(discovery, []);
    const atC = [];
    C.on('envelope', (e) => atC.push(e));
    C.on('security-error', (_e, env) => { if (env) atC.push(env); });
    await B.setDiscoverability(DISCOVERABILITY.PUBLISH);
    await C.setDiscoverability(DISCOVERABILITY.PUBLISH);
    await A.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(await settle(() => A.canReach(b.pubKey) && A.canReach(C.lanAddress)), 'A on both').toBe(true);
    await expect(A.sendOneWay(C.lanAddress, { leak: 1 }, { from: a.pubKey })).rejects.toThrow();
    await wait(200);
    expect(atC.some((e) => e?._from === a.pubKey), 'C never hears A\'s bound address').toBe(false);
  });
});
