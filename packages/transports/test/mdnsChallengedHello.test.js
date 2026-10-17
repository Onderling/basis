/**
 * THE LAN HELLO IS PROVEN, NOT CLAIMED. A connection used to be keyed by the `_mdns_hello` frame's `_from` — an
 * unsigned field — and a dialler trusted the TXT record's pubKey. So a device on the Wi-Fi could hello as someone
 * else's key and become that ROW (and the route for what this device sends "to" them), or advertise someone else's
 * key and receive what a dialler meant for them. Now each side signs the other's nonce; a connection is a peer and a
 * route only when that signature verifies under the key it claims.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { MdnsTransport, SERVICE_TYPE } from '../src/MdnsTransport.js';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '../src/mdnsNodeBackend.js';
import { b64Encode } from '../src/utils/base64.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 120) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); } return false; };
const frame = (obj) => b64Encode(new TextEncoder().encode(JSON.stringify(obj)));
const ident = async () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());

describe('the challenged hello', () => {
  const open = [];
  afterEach(async () => { for (const t of open.splice(0)) await t.disconnect?.().catch?.(() => {}); });
  const peer = async (discovery, identity) => {
    identity ??= await ident();
    const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const t = new MdnsTransport({ identity, native, emitter });
    open.push(t);
    return { identity, transport: t };
  };

  it('a hello claiming A, from someone who is not A: no row, no route — and the real A still binds', async () => {
    const discovery = createLoopbackDiscovery();
    // B listens; it must be the responder to A (A's key sorts lower), so A will dial it
    let a, b;
    do { a = await ident(); b = await ident(); } while (!(a.pubKey < b.pubKey));
    const B = await peer(discovery, b);
    const seen = [];
    B.transport.on('peer-discovered', (k) => seen.push(k));
    await B.transport.connect();

    // the squatter dials B straight from a backend and hellos as A
    const squat = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    let port = null;
    await discovery.browse({ serviceType: SERVICE_TYPE, onFound: (r) => { if (r.pubKey === b.pubKey) port = r.port; } });
    expect(port, 'B is advertised').not.toBe(null);
    const conn = await squat.native.connect('127.0.0.1', port);
    await squat.native.send(conn, frame({ _mdns_hello: true, _from: a.pubKey }));
    await wait(300);
    expect(B.transport.canReach(a.pubKey), 'a claim is not a route').toBe(false);
    expect(seen, 'a claim is not a row').not.toContain(a.pubKey);

    // the real A comes along: its proof binds
    const A = await peer(discovery, a);
    await A.transport.connect();
    expect(await settle(() => B.transport.canReach(a.pubKey) && A.transport.canReach(b.pubKey)), 'the real A binds both ways').toBe(true);
    const got = [];
    B.transport.on('envelope', (e) => got.push(e));
    await A.transport.sendOneWay(b.pubKey, { hi: 1 });
    expect(await settle(() => got.length > 0)).toBe(true);
    await squat.native.stop?.().catch?.(() => {});
  });

  it('a service advertising B\'s key, run by someone who is not B: the dialler never routes to it as B', async () => {
    const discovery = createLoopbackDiscovery();
    const a = await ident(); const b = await ident(); const m = await ident();
    // the squatter runs a real transport under ITS key but advertises B's pubKey
    const squat = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    await squat.native.start(SERVICE_TYPE, 'squat', b.pubKey);
    squat.emitter.addListener('MdnsClientConnected', () => {});
    const A = await peer(discovery, a);
    const seen = [];
    A.transport.on('peer-discovered', (k) => seen.push(k));
    await A.transport.connect();
    await wait(400);
    expect(A.transport.canReach(b.pubKey), 'a TXT record is not a route').toBe(false);
    expect(seen).not.toContain(b.pubKey);
    void m;
    await squat.native.stop?.().catch?.(() => {});
  });
});
