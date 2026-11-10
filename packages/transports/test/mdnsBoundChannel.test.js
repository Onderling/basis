/**
 * THE LAN CONNECTION IS A CHANNEL, NOT JUST A PROVEN HELLO. The challenged hello proves the far end holds the key it
 * claims; it cannot prove nobody sits between. A device on the Wi-Fi that forwards both handshakes verbatim used to
 * end up holding the route at both ends: it read every frame, and could push frames of its own onto a connection the
 * receiver had keyed to the honest peer. Now each hello carries an ephemeral key, the signatures cover both, and
 * every frame after the hello is boxed under the shared key: the forwarder relays bytes it can neither read nor forge.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, DISCOVERABILITY } from '@onderling/core';
import { MdnsTransport, SERVICE_TYPE } from '../src/MdnsTransport.js';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '../src/mdnsNodeBackend.js';
import { b64Encode, b64Decode } from '../src/utils/base64.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 160) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); } return false; };
const ident = async () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
const text = (data) => new TextDecoder().decode(b64Decode(data));
const frame = (obj) => b64Encode(new TextEncoder().encode(JSON.stringify(obj)));

describe('the bound channel', () => {
  const open = [];
  afterEach(async () => { for (const x of open.splice(0)) await x(); });

  it('a verbatim forwarder between A and B can neither read a frame nor push one of its own', async () => {
    const a = await ident(); const b = await ident();
    // A sees only the forwarder (which advertises B's key); the forwarder reaches the real B on B's own network
    const nearA = createLoopbackDiscovery();
    const nearB = createLoopbackDiscovery();

    const mk = (discovery, identity) => {
      const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
      const t = new MdnsTransport({ identity, lanIdentity: identity, native, emitter });
      open.push(() => t.disconnect());
      return t;
    };
    const B = mk(nearB, b);
    const got = [];
    B.on('envelope', (e) => got.push(e));
    await B.setDiscoverability(DISCOVERABILITY.PUBLISH);

    // the forwarder: a listener on A's side advertising B's key, and a dialler to the real B
    const S = createMdnsNodeBackend({ discovery: nearA, host: '127.0.0.1' });
    const toB = createMdnsNodeBackend({ discovery: nearB, host: '127.0.0.1' });
    open.push(() => S.native.stop(), () => toB.native.stop());
    let bPort = null;
    await nearB.browse({ serviceType: SERVICE_TYPE, onFound: (r) => { if (r.pubKey === b.pubKey) bPort = r.port; } });
    expect(bPort, 'B is advertised').not.toBe(null);
    const seen = [];
    const pair = new Map();   // A-side connection → B-side connection
    const back = new Map();
    S.emitter.addListener('MdnsClientConnected', async ({ connectionId }) => {
      const c = await toB.native.connect('127.0.0.1', bPort);
      pair.set(connectionId, c); back.set(c, connectionId);
    });
    S.emitter.addListener('MdnsDataReceived', async ({ connectionId, data }) => {
      seen.push(text(data));
      await settle(() => pair.has(connectionId));
      await toB.native.send(pair.get(connectionId), data);
    });
    toB.emitter.addListener('MdnsDataReceived', async ({ connectionId, data }) => {
      seen.push(text(data));
      await S.native.send(back.get(connectionId), data);
    });
    await S.native.start(SERVICE_TYPE, 'forwarder', b.pubKey);

    const A = mk(nearA, a);
    await A.setDiscoverability(DISCOVERABILITY.BROWSE);   // browse only: A dials whatever it finds
    expect(await settle(() => A.canReach(b.pubKey) && B.canReach(a.pubKey)), 'the forwarded handshake completes').toBe(true);

    await A.sendOneWay(b.pubKey, { _from: a.pubKey, secret: 'only-for-B' });
    await wait(300);
    expect(seen.some((s) => s.includes('only-for-B')), 'the forwarder reads no data frame').toBe(false);

    // the forwarder pushes a frame of its own onto B's connection, under A's proven key
    const injected = got.length;
    await toB.native.send([...back.keys()][0], frame({ _from: a.pubKey, forged: 'by-the-forwarder' }));
    await wait(300);
    expect(got.slice(injected).some((e) => e.forged), 'B delivers nothing the forwarder wrote').toBe(false);
  });
});
