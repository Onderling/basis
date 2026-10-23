/**
 * Transport PORT conformance — run the harness against two reference adapters:
 *   • InternalTransport   (@onderling/core — in-process bus)
 *   • RendezvousTransport (@onderling/transports — WebRTC DataChannel)
 *
 * Both MUST pass: implementing the port + passing this harness is the definition
 * of "compatible with the @onderling SDK". See docs/conventions/ports.md.
 */
import { describe, it } from 'vitest';
import { assertTransportConformance, assertSenderBindingConformance } from '@onderling/core/conformance';
import { InternalBus, InternalTransport } from '../../src/transport/InternalTransport.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { RendezvousTransport } from '@onderling/transports';
import { VaultMemory } from '@onderling/vault';
import { createFakeRtcLib, securedSignalPair } from '../support/fakeRtc.js';
import { Agent } from '../../src/Agent.js';

// ── Reference adapter 1: InternalTransport ──────────────────────────────────
describe('Transport port — InternalTransport (reference adapter)', () => {
  it('satisfies the Transport port', async () => {
    await assertTransportConformance(async () => {
      const bus = new InternalBus();
      const a = new InternalTransport(bus, 'conf-a');
      const b = new InternalTransport(bus, 'conf-b');
      await a.connect();
      await b.connect();
      return {
        a, b, addrA: 'conf-a', addrB: 'conf-b',
        async teardown() { await a.disconnect(); await b.disconnect(); },
      };
    }, { label: 'InternalTransport' });
  });
});

// ── Reference adapter 2: RendezvousTransport ────────────────────────────────
// Gate on the WebRTC polyfill being installable (same pattern as
// transport/RendezvousTransport.test.js); skip cleanly if absent.
let rtcLib = null;
try {
  const mod = await import('node-datachannel/polyfill');
  rtcLib = {
    RTCPeerConnection:     mod.RTCPeerConnection,
    RTCSessionDescription: mod.RTCSessionDescription,
    RTCIceCandidate:       mod.RTCIceCandidate,
  };
} catch (e) {
  console.warn('[transport.conformance] node-datachannel polyfill not available, ' +
    'skipping RendezvousTransport conformance (', e?.message ?? e, ')');
}
const dRdv = rtcLib ? describe : describe.skip;

dRdv('Transport port — RendezvousTransport (reference adapter)', () => {
  it('satisfies the Transport port', async () => {
    await assertTransportConformance(async () => {
      const bus = new InternalBus();
      const aId = await AgentIdentity.generate(new VaultMemory());
      const bId = await AgentIdentity.generate(new VaultMemory());

      // Signalling over the in-process bus so the test is fully local.
      const aSig = new InternalTransport(bus, aId.pubKey, { identity: aId });
      const bSig = new InternalTransport(bus, bId.pubKey, { identity: bId });
      await aSig.connect();
      await bSig.connect();

      const a = new RendezvousTransport({ signalingTransport: aSig, identity: aId, rtcLib });
      const b = new RendezvousTransport({ signalingTransport: bSig, identity: bId, rtcLib });
      await a.connect();
      await b.connect();

      // Establish the bidirectional DataChannel before the harness runs.
      await a.connectToPeer(bId.pubKey, 15_000);

      return {
        a, b, addrA: aId.pubKey, addrB: bId.pubKey,
        async teardown() {
          await a.disconnect(); await b.disconnect();
          await aSig.disconnect(); await bSig.disconnect();
        },
      };
    }, { label: 'RendezvousTransport', timeout: 8_000 });
  }, 30_000);
});

// The sender-binding case: a frame on the DataChannel claiming another address than the channel's peer is dropped.
// Run over a fake WebRTC library (test/support/fakeRtc.js), so it RUNS here and on CI instead of skipping with the
// native polyfill: the case is about what the transport does with frames on an open channel, which the fake carries.
describe('Transport port — RendezvousTransport sender binding', () => {
  it('a DataChannel frame claiming another sender than the channel\'s peer is dropped', async () => {
    await assertSenderBindingConformance(async () => {
      const pair = await securedSignalPair({ Agent, AgentIdentity, InternalBus, InternalTransport, VaultMemory });
      const other = await AgentIdentity.generate(new VaultMemory());
      const fake = createFakeRtcLib();
      const a = new RendezvousTransport({ signalingTransport: pair.a.sig, identity: pair.a.identity, rtcLib: fake });
      const b = new RendezvousTransport({ signalingTransport: pair.b.sig, identity: pair.b.identity, rtcLib: fake });
      await a.connect(); await b.connect();
      await a.connectToPeer(pair.b.identity.pubKey, 5_000);
      return {
        a, b, addrA: pair.a.identity.pubKey, addrB: pair.b.identity.pubKey, forgedAddr: other.pubKey,
        async teardown() { await a.disconnect(); await b.disconnect(); await pair.stop(); },
      };
    }, { label: 'RendezvousTransport', timeout: 8_000 });
  }, 30_000);
});
