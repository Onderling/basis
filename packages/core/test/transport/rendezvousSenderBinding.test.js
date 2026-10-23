/**
 * A WebRTC DataChannel is opened to ONE peer; a frame on it claiming any other sender is dropped, counted and
 * reported as a `security-error` (`SENDER_MISMATCH`) — the way the agent's refused-inbound path warns once per
 * sender. Run over the fake WebRTC library (test/support/fakeRtc.js), so it runs where the native polyfill does not.
 */
import { describe, it, expect } from 'vitest';
import { InternalBus, InternalTransport } from '../../src/transport/InternalTransport.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { mkEnvelope, P } from '../../src/Envelope.js';
import { RendezvousTransport } from '@onderling/transports';
import { VaultMemory } from '@onderling/vault';
import { createFakeRtcLib } from '../support/fakeRtc.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('RendezvousTransport — the sender is the channel\'s peer', () => {
  it('a frame claiming another sender is dropped, counted and reported; the channel stays open', async () => {
    const bus = new InternalBus();
    const [aId, bId, other] = await Promise.all([1, 2, 3].map(() => AgentIdentity.generate(new VaultMemory())));
    const aSig = new InternalTransport(bus, aId.pubKey, { identity: aId });
    const bSig = new InternalTransport(bus, bId.pubKey, { identity: bId });
    await aSig.connect(); await bSig.connect();
    const fake = createFakeRtcLib();
    const a = new RendezvousTransport({ signalingTransport: aSig, identity: aId, rtcLib: fake });
    const b = new RendezvousTransport({ signalingTransport: bSig, identity: bId, rtcLib: fake });
    await a.connect(); await b.connect();
    await a.connectToPeer(bId.pubKey, 5_000);
    const got = []; const refused = [];
    b.setReceiveHandler((env) => got.push(env));
    b.on('security-error', (err, raw) => refused.push({ code: err?.code, from: raw?._from }));

    await a._put(bId.pubKey, mkEnvelope(P.OW, other.pubKey, bId.pubKey, { forged: true }));
    await a.sendOneWay(bId.pubKey, { honest: true });
    await wait(50);
    expect(got.map((e) => e.payload)).toEqual([{ honest: true }]);
    expect(b.refusedSenders).toBe(1);
    expect(refused).toEqual([{ code: 'SENDER_MISMATCH', from: other.pubKey }]);
    expect(b.hasOpenChannelTo(aId.pubKey), 'the channel stays open').toBe(true);
    await a.disconnect(); await b.disconnect(); await aSig.disconnect(); await bSig.disconnect();
  });
});
