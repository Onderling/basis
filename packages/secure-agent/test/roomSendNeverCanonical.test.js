/**
 * A ROOM SEND NEVER SPEAKS AS THE PERSON. A Nearby room speaks as its room key (`requireSendAs`); that key exists so a
 * stranger in the room never learns the person's canonical address. A transport that cannot carry an address of ours as
 * the sender (NKN, alias-blind: its wire sender is the canonical key) must therefore never carry a room send: under the
 * accepted address fallback it would speak as the canonical identity, which is the CIRCLE's consent, not a room's.
 * The phone walk (2026-11-27, the admin's log) showed exactly that: the room greeting's handshake went over NKN "speaking
 * as the canonical identity", while the relay refused the same send ("does not hold that address").
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity, InternalBus, InternalTransport, DISCOVERABILITY } from '@onderling/core';
import { MdnsTransport } from '@onderling/transports/mdns';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '@onderling/transports/mdns-node';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };

/** NKN's shape: no aliases, so its wire sender is always the canonical key. */
class MeshTransport extends InternalTransport {
  get supportsAliases() { return false; }
}

const agent = (onPeerMessage) => createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });
const ident = () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), new VaultMemory());
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return !!fn(); };
/** Every envelope a transport puts on the wire. */
function watch(transport) {
  const log = [];
  const put = transport._put?.bind(transport);
  if (put) transport._put = async (to, env) => { log.push({ to, env }); return put(to, env); };
  return log;
}

describe('a room send never speaks as the person', () => {
  it('with only an alias-blind transport, the room greeting is refused and the canonical key never reaches the wire', async () => {
    const bus = new InternalBus();
    const anna = await agent();
    const bram = await agent();
    const roomIdentity = await ident();
    const room = roomIdentity.pubKey;
    expect(anna.registerSelfIdentity(room, roomIdentity), 'the room key is one of anna\'s identities').toBe(true);
    const mesh = new MeshTransport(bus, anna.identity.pubKey);
    await anna.addSecureTransport('nkn', mesh);
    await bram.addSecureTransport('nkn', new MeshTransport(bus, bram.identity.pubKey));
    const wire = watch(mesh);

    const err = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'nearby-presence', presence: { label: 'Ada' } },
      { ...FAST, sendAs: room, requireSendAs: true, guarantee: 'now' }).then(() => null, (e) => e);
    expect(err?.code, `refused with its own code, not sent (${err?.message})`).toBe('SEND_AS_NOT_CARRIED');
    expect(JSON.stringify(wire.map((w) => w.env)), 'the canonical key crossed the wire').not.toContain(anna.identity.pubKey);
    // never held, whatever the caller asked: a room message does not outlive the visit
    const held = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'nearby-presence', msgId: 'p2', presence: { label: 'Ada' } },
      { ...FAST, sendAs: room, requireSendAs: true, guarantee: 'hold-forward' }).then((r) => r, (e) => ({ refused: e?.code }));
    expect(held?.held, 'a room send was held for later').not.toBe(true);
    expect(held?.refused).toBe('SEND_AS_NOT_CARRIED');
    expect(JSON.stringify(wire.map((w) => w.env))).not.toContain(anna.identity.pubKey);
    await anna.shutdown(); await bram.shutdown();
  }, 20_000);

  // the room's real path: mDNS carries the room key (the node backend, loopback discovery, as lanSpeaksOnlyLanKey does)
  it('with mDNS beside it, the room greeting goes over mDNS, heard from the room key, and nothing goes over NKN', async () => {
    const discovery = createLoopbackDiscovery();
    const busN = new InternalBus();
    const got = [];
    const otherRoom = await ident();
    const other = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: (m) => got.push(m) });
    const om = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const otherMdns = new MdnsTransport({ identity: other.agent.identity, lanIdentity: otherRoom, native: om.native, emitter: om.emitter });
    await other.addSecureTransport('mdns', otherMdns, { connect: false });
    await other.addSecureTransport('nkn', new MeshTransport(busN, other.identity.pubKey));
    expect(other.registerSelfIdentity(otherRoom.pubKey, otherRoom)).toBe(true);
    await otherMdns.setDiscoverability(DISCOVERABILITY.PUBLISH);

    const roomIdentity = await ident();
    const room = roomIdentity.pubKey;
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    const am = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const annaMdns = new MdnsTransport({ identity: anna.agent.identity, lanIdentity: roomIdentity, native: am.native, emitter: am.emitter });
    await anna.addSecureTransport('mdns', annaMdns, { connect: false });
    const mesh = new MeshTransport(busN, anna.identity.pubKey);
    await anna.addSecureTransport('nkn', mesh);
    expect(anna.registerSelfIdentity(room, roomIdentity)).toBe(true);
    await annaMdns.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(await until(() => annaMdns.canReach(otherMdns.lanAddress), 5000), 'on the LAN').toBe(true);
    const onMesh = watch(mesh);

    await anna.peer.sendTo(otherMdns.lanAddress, { subtype: 'nearby-presence', presence: { label: 'Ada' } },
      { ...FAST, sendAs: room, requireSendAs: true, guarantee: 'now' });
    expect(await until(() => got.some((m) => m.payload?.subtype === 'nearby-presence')), 'the greeting arrived').toBe(true);
    expect(got.find((m) => m.payload?.subtype === 'nearby-presence').from, 'heard from the room key').toBe(room);
    expect(onMesh, 'nothing went over the alias-blind transport').toEqual([]);
    await anna.shutdown(); await other.shutdown();
  }, 30_000);
});
