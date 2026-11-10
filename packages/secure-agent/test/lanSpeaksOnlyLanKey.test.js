/**
 * THE LAN SPEAKS ONLY ITS LAN KEY — at the agent, not only in the hello. The mDNS transport sits behind the agent's
 * security layer, so what decides who a frame is FROM is the identity the agent signs with, not the key the transport
 * said in the hello. Two rules, over real sockets (the node mDNS backend, loopback discovery):
 *
 *   1. A stranger on the LAN (a harvester the resting phone dialled) receives nothing the agent signs as its canonical
 *      key — not even when something asks the agent to send to that stranger's LAN key.
 *   2. A room speaks as its room key: an address of ours that the LAN transport speaks (its LAN key) is sent over that
 *      transport only, signed by the identity registered for it, and the receiver hears it from that key.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity, DISCOVERABILITY } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { MdnsTransport } from '@onderling/transports/mdns';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '@onderling/transports/mdns-node';
import { createSecureAgent } from '../src/createSecureAgent.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(25); } return !!(await fn()); };
const ident = () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), new VaultMemory());

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

async function device(discovery, { lanIdentity = null, onPeerMessage = null } = {}) {
  const sa = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, ...(onPeerMessage ? { onPeerMessage } : {}) });
  cleanups.push(() => sa.shutdown());
  const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
  const mdns = new MdnsTransport({ identity: sa.agent.identity, lanIdentity, native, emitter });
  await sa.addSecureTransport('mdns', mdns, { connect: false });
  return { sa, mdns, canonical: sa.identity.pubKey };
}

describe('the LAN speaks only its LAN key, at the agent', () => {
  it('a stranger the resting phone dialled receives nothing the agent signs as its canonical key', async () => {
    const discovery = createLoopbackDiscovery();
    const harvester = await device(discovery);
    const heard = [];   // every agent envelope that reached the harvester's transport, accepted or refused
    harvester.mdns.on('envelope', (e) => heard.push(e));
    harvester.mdns.on('security-error', (_err, e) => { if (e) heard.push(e); });
    await harvester.mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);

    const phone = await device(discovery);
    await phone.mdns.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(await until(() => phone.mdns.canReach(harvester.mdns.lanAddress)), 'the resting phone dialled the publisher').toBe(true);

    // something asks the agent to send to the stranger's LAN key, as itself
    await phone.sa.peer.sendTo(harvester.mdns.lanAddress, { hello: 'world' }, { firstSendTimeoutMs: 600, retryDelays: [] }).catch(() => {});
    await wait(300);
    expect(heard.map((e) => e?._from), 'no envelope from the canonical key crossed the LAN').not.toContain(phone.canonical);
    expect(heard.length, 'nothing the agent signs crossed to the stranger').toBe(0);
  }, 30_000);

  it('a room speaks as its room key: sent over the LAN only, signed by the room identity, heard from it', async () => {
    const discovery = createLoopbackDiscovery();
    const got = [];
    // the other device is in the room too (a room talks to the room: an answer goes out as the answerer's room key)
    const otherRoom = await ident();
    const other = await device(discovery, { lanIdentity: otherRoom, onPeerMessage: (m) => got.push(m) });
    expect(other.sa.registerSelfIdentity(otherRoom.pubKey, otherRoom)).toBe(true);
    await other.mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);

    const roomIdentity = await ident();
    const phone = await device(discovery, { lanIdentity: roomIdentity });
    const room = roomIdentity.pubKey;
    expect(phone.sa.registerSelfIdentity(room, roomIdentity), 'the room key is one of our identities').toBe(true);
    await phone.mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(await until(() => phone.mdns.canReach(other.mdns.lanAddress)), 'on the LAN').toBe(true);

    await phone.sa.peer.sendTo(other.mdns.lanAddress, { subtype: 'nearby-presence', presence: { label: 'Ada' } }, { sendAs: room });
    expect(await until(() => got.length > 0), 'the room message arrived').toBe(true);
    expect(got[0].from, 'heard from the room key').toBe(room);
    expect(got[0].from).not.toBe(phone.canonical);
  }, 30_000);

  it('in a room, a send that does not ask to speak as the room key carries nothing: its hello would name the canonical key', async () => {
    const discovery = createLoopbackDiscovery();
    const otherRoom = await ident();
    const other = await device(discovery, { lanIdentity: otherRoom });
    expect(other.sa.registerSelfIdentity(otherRoom.pubKey, otherRoom)).toBe(true);
    const heard = [];
    other.mdns.on('envelope', (e) => heard.push(JSON.stringify(e)));
    other.mdns.on('security-error', (_err, e) => { if (e) heard.push(JSON.stringify(e)); });
    await other.mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);

    const roomIdentity = await ident();
    const phone = await device(discovery, { lanIdentity: roomIdentity });
    expect(phone.sa.registerSelfIdentity(roomIdentity.pubKey, roomIdentity)).toBe(true);
    await phone.mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(await until(() => phone.mdns.canReach(other.mdns.lanAddress)), 'on the LAN').toBe(true);

    await phone.sa.peer.sendTo(other.mdns.lanAddress, { hi: 'there' }, { firstSendTimeoutMs: 600, retryDelays: [] }).catch(() => {});
    await wait(300);
    expect(heard.some((e) => e.includes(phone.canonical)), 'the canonical key never reached the room').toBe(false);
  }, 30_000);

  it('a PERSONA in the room: its room key still speaks over the LAN, never on the persona\'s relay sockets', async () => {
    const discovery = createLoopbackDiscovery();
    const got = [];
    const otherRoom = await ident();
    const other = await device(discovery, { lanIdentity: otherRoom, onPeerMessage: (m) => got.push(m) });
    expect(other.sa.registerSelfIdentity(otherRoom.pubKey, otherRoom)).toBe(true);
    await other.mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);

    const persona = await ident();   // the self the device entered the room as: not the default identity
    const roomIdentity = await ident();
    const phone = await device(discovery, { lanIdentity: roomIdentity });
    const room = roomIdentity.pubKey;
    expect(phone.sa.registerSelfIdentity(room, roomIdentity, { owner: persona.pubKey })).toBe(true);
    await phone.mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(await until(() => phone.mdns.canReach(other.mdns.lanAddress)), 'on the LAN').toBe(true);

    const r = await phone.sa.peer.sendTo(other.mdns.lanAddress, { subtype: 'nearby-presence', presence: { label: 'Werk' } }, { sendAs: room });
    expect(r?.reason ?? null, 'not held for a relay socket the persona has none of').not.toBe('persona-no-connection');
    expect(await until(() => got.length > 0), 'the room message arrived over the LAN').toBe(true);
    expect(got[0].from).toBe(room);
  }, 30_000);
});
