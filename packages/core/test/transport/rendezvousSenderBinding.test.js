/**
 * WebRTC rendezvous binds who is on the other end, twice:
 *   • the channel's peer is the offer's `from`, which must be the key that SIGNED the signalling envelope (verified by
 *     the signalling transport's security layer) — an offer naming anyone else, or arriving unsigned, is refused;
 *   • a frame on an open DataChannel claiming any other sender than the channel's peer is dropped, counted and
 *     reported as a `security-error` (`SENDER_MISMATCH`).
 * Over the fake WebRTC library (test/support/fakeRtc.js), so it runs where the native polyfill does not.
 */
import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/Agent.js';
import { InternalBus, InternalTransport } from '../../src/transport/InternalTransport.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { mkEnvelope, P } from '../../src/Envelope.js';
import { RendezvousTransport } from '@onderling/transports';
import { VaultMemory } from '@onderling/vault';
import { createFakeRtcLib, securedSignalPair } from '../support/fakeRtc.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const kit = { Agent, AgentIdentity, InternalBus, InternalTransport, VaultMemory };

describe('RendezvousTransport — who is on the other end', () => {
  it('a frame claiming another sender is dropped, counted and reported; the channel stays open', async () => {
    const pair = await securedSignalPair(kit);
    const other = await AgentIdentity.generate(new VaultMemory());
    const fake = createFakeRtcLib();
    const a = new RendezvousTransport({ signalingTransport: pair.a.sig, identity: pair.a.identity, rtcLib: fake });
    const b = new RendezvousTransport({ signalingTransport: pair.b.sig, identity: pair.b.identity, rtcLib: fake });
    await a.connect(); await b.connect();
    await a.connectToPeer(pair.b.identity.pubKey, 5_000);
    const got = []; const refused = [];
    b.setReceiveHandler((env) => got.push(env));
    b.on('security-error', (err, raw) => refused.push({ code: err?.code, from: raw?._from }));
    await a._put(pair.b.identity.pubKey, mkEnvelope(P.OW, other.pubKey, pair.b.identity.pubKey, { forged: true }));
    await a.sendOneWay(pair.b.identity.pubKey, { honest: true });
    await wait(50);
    expect(got.map((e) => e.payload)).toEqual([{ honest: true }]);
    expect(b.refusedSenders).toBe(1);
    expect(refused).toEqual([{ code: 'SENDER_MISMATCH', from: other.pubKey }]);
    expect(b.hasOpenChannelTo(pair.a.identity.pubKey), 'the channel stays open').toBe(true);
    await a.disconnect(); await b.disconnect(); await pair.stop();
  });

  it('an offer whose from is not the key that signed it is refused: no channel under the claimed name', async () => {
    const pair = await securedSignalPair(kit);
    const victim = await AgentIdentity.generate(new VaultMemory());
    const fake = createFakeRtcLib();
    const b = new RendezvousTransport({ signalingTransport: pair.b.sig, identity: pair.b.identity, rtcLib: fake });
    await b.connect();
    const refused = [];
    b.on('security-error', (err) => refused.push(err?.code));
    // A (honestly signed as A) sends an offer that NAMES the victim as the offerer
    await pair.a.sig.sendOneWay(pair.b.identity.pubKey, { type: 'rtc-offer', from: victim.pubKey, sdp: 'offer-x' });
    await wait(50);
    expect(b.refusedSenders, 'refused').toBe(1);
    expect(refused).toEqual(['SENDER_MISMATCH']);
    expect(b.hasOpenChannelTo(victim.pubKey), "no channel under the victim's name").toBe(false);
    await b.disconnect(); await pair.stop();
  });

  it('unsigned signalling is refused (fail closed — production signals over a secured transport)', async () => {
    const bus = new InternalBus();
    const [aId, bId] = await Promise.all([1, 2].map(() => AgentIdentity.generate(new VaultMemory())));
    const aSig = new InternalTransport(bus, aId.pubKey, { identity: aId });   // no security layer: unsigned
    const bSig = new InternalTransport(bus, bId.pubKey, { identity: bId });
    await aSig.connect(); await bSig.connect();
    const fake = createFakeRtcLib();
    const b = new RendezvousTransport({ signalingTransport: bSig, identity: bId, rtcLib: fake });
    await b.connect();
    await aSig.sendOneWay(bId.pubKey, { type: 'rtc-offer', from: aId.pubKey, sdp: 'offer-y' });
    await wait(50);
    expect(b.refusedSenders).toBe(1);
    expect(b.hasOpenChannelTo(aId.pubKey)).toBe(false);
    await b.disconnect(); await aSig.disconnect(); await bSig.disconnect();
  });
});
