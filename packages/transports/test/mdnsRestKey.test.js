/**
 * A PHONE AT REST DOES NOT GIVE ITS KEY AWAY. At rest the phone only browses (it announces nothing), but a browsing
 * device that discovers a publisher dials it and proves a key in the hello. If that key is the person's canonical
 * chat key, any device on the Wi-Fi that publishes the service type collects the DM address of every phone running
 * the app, without anyone opening Nearby. The LAN speaks only a LAN key: at rest a random key drawn per network
 * visit, tied to no self.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, DISCOVERABILITY } from '@onderling/core';
import { MdnsTransport, SERVICE_TYPE } from '../src/MdnsTransport.js';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '../src/mdnsNodeBackend.js';
import { b64Decode } from '../src/utils/base64.js';

const throwawayVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (fn, tries = 120) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(25); } return false; };
const ident = async () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());

/** A harvester: publishes the service type and records every hello's `_from` that reaches it. */
async function harvester(discovery) {
  const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
  const froms = [];
  emitter.addListener('MdnsClientConnected', () => {});
  emitter.addListener('MdnsDataReceived', ({ data }) => {
    try {
      const f = JSON.parse(new TextDecoder().decode(b64Decode(data)));
      if (f?._mdns_hello) froms.push(f._from);
    } catch { /* not a frame we read */ }
  });
  const bait = await ident();
  await native.start(SERVICE_TYPE, 'harvest', bait.pubKey);
  return { froms, stop: () => native.stop?.().catch?.(() => {}) };
}

describe('the resting browse', () => {
  const open = [];
  afterEach(async () => { for (const x of open.splice(0)) await x.stop?.(); });

  it('a browsing phone that dials a publisher does not prove its canonical key', async () => {
    const discovery = createLoopbackDiscovery();
    const H = await harvester(discovery);
    open.push(H);

    const canonical = await ident();
    const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const phone = new MdnsTransport({ identity: canonical, native, emitter });
    open.push({ stop: () => phone.disconnect() });
    expect(phone.supportsSplit(), 'the node backend can browse without publishing').toBe(true);
    await phone.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(phone.isAdvertising, 'at rest the phone announces nothing').toBe(false);

    expect(await settle(() => H.froms.length > 0), 'the resting phone dialled the publisher').toBe(true);
    expect(H.froms, 'the hello carries no canonical key').not.toContain(canonical.pubKey);
    const firstVisit = phone.lanAddress;
    expect(H.froms).toContain(firstVisit);

    // a new network (the surface re-announces after a Wi-Fi change) is a new visit: a new key
    await phone.reannounce?.(DISCOVERABILITY.BROWSE) ?? phone._reannounce(DISCOVERABILITY.BROWSE);
    expect(phone.lanAddress, 'two network visits give two keys').not.toBe(firstVisit);
    expect(phone.lanAddress).not.toBe(canonical.pubKey);
    expect(await settle(() => H.froms.includes(phone.lanAddress)), 'the second visit dials under the new key').toBe(true);
  });

  it('what is announced (TXT key and host name) follows the LAN key: a room key in, a fresh rest key out, never the canonical', async () => {
    const inner = createLoopbackDiscovery();
    const records = [];
    const discovery = { advertise: (r) => { records.push(r); return inner.advertise(r); }, browse: (b) => inner.browse(b) };
    const canonical = await ident();
    const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const phone = new MdnsTransport({ identity: canonical, native, emitter });
    open.push({ stop: () => phone.disconnect() });
    await phone.setDiscoverability(DISCOVERABILITY.PUBLISH);
    const room = await ident();
    await phone.useLanIdentity(room);
    await phone.useLanIdentity(null);
    const said = records.map((r) => ({ key: r.txt?.pubKey, name: r.serviceName }));
    expect(said).toHaveLength(3);
    expect(said[1].key, 'in the room: the room key').toBe(room.pubKey);
    expect(new Set(said.map((x) => x.key)).size, 'three presences, three keys').toBe(3);
    for (const x of said) {
      expect(x.key).not.toBe(canonical.pubKey);
      expect(x.name, 'the host name carries the LAN key\'s slice').toBe(`dw-${x.key.slice(0, 8)}`);
      expect(x.name).not.toContain(canonical.pubKey.slice(0, 8));
    }
  });

  it('two phones of one persona on one LAN do not skip each other as self', async () => {
    const discovery = createLoopbackDiscovery();
    // the chat identity is profile-derived: the same seed on every device of the persona
    const seed = new Uint8Array(randomBytes(32));
    const phones = [];
    for (let i = 0; i < 2; i++) {
      const identity = await AgentIdentity.fromSeed(seed, throwawayVault());
      const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
      const t = new MdnsTransport({ identity, native, emitter });
      open.push({ stop: () => t.disconnect() });
      phones.push(t);
    }
    await phones[0].setDiscoverability(DISCOVERABILITY.PUBLISH);
    await phones[1].setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(await settle(() => phones[0]._pubKeyToConn.size > 0 && phones[1]._pubKeyToConn.size > 0),
      'each phone holds a LAN connection to its sibling').toBe(true);
  });
});
