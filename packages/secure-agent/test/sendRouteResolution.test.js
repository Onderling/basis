/**
 * @onderling/secure-agent — Phase-2 · Piece-2 (B2 wiring) integration test.
 *
 * Slice-1 gave the secure send path REAL failover, but on the live path it was
 * inert: the shared RoutingStrategy carried no PeerGraph, so `route → addressFor`
 * could not resolve a peer's transport-appropriate wire address, and there was
 * nothing proving that with BOTH tiers registered a peer reachable over only one
 * of them actually gets reached. This slice attaches a PeerGraph to the shared
 * router (`sa.attachPeerGraph`) and proves the previously-broken cases.
 *
 * REAL transport wiring — no bespoke mocks: each tier is a genuine
 * `InternalTransport` (a real core `Transport`) on its own `InternalBus`, so a
 * peer "reachable only over the relay tier" is modelled by putting the target on
 * the relay bus but NOT the nkn bus. Delivery is in-process microtask async —
 * deterministic, instant, no sockets/relay/network.
 *
 * Proven here:
 *   1. with BOTH tiers registered, `route(peer)` selects the higher-priority
 *      (relay) tier, the attached PeerGraph resolves per-transport addresses
 *      (B2 `addressesOf`), and a peer reachable ONLY over the relay bus is
 *      actually reached — the redeem-over-relay case that was broken;
 *   2. the control: with ONLY the nkn tier registered (the pre-slice-2 "relay
 *      is not a candidate" shape), that same relay-only peer is UNREACHABLE;
 *   3. a transport-class failure on the selected relay tier drives
 *      `onTransportFailure` → failover lands on the still-reachable nkn tier.
 */
import { describe, it, expect, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, PeerGraph } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

// Fast + deterministic: short HI wait (in-process HI settles in a microtask or
// two), no outer handshake-retry backoff — we exercise routing, not races.
const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };

/** Resolve once `pred()` is truthy, polling briefly. Keeps the async in-process
 *  HI + delivery deterministic without a fixed sleep. */
async function until(pred, { timeout = 1500, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return pred();
}

async function makeAgent(onPeerMessage) {
  return createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });
}

describe('secure-agent slice-2 — registered tiers + PeerGraph address resolution', () => {
  it('with both tiers registered, route() picks relay, addressesOf resolves, and a relay-only peer is reached', async () => {
    const busRelay = new InternalBus();
    const busNkn   = new InternalBus();

    const received = [];
    const sender = await makeAgent();
    const target = await makeAgent((m) => received.push(m));

    const targetId = target.identity.pubKey;
    // A peer exposes a DIFFERENT wire address per transport: relay routes by the
    // Ed25519 pubKey; NKN by a seed-derived native address. Model that split.
    const relayAddr = targetId;                 // relay uses the pubKey
    const nknAddr   = `nkn-native:${target.identity.stableId}`;

    // Sender is on BOTH buses; target is on ONLY the relay bus.
    await sender.addSecureTransport('relay', new InternalTransport(busRelay, sender.identity.pubKey));
    await sender.addSecureTransport('nkn',   new InternalTransport(busNkn,   sender.identity.pubKey));
    await target.addSecureTransport('relay', new InternalTransport(busRelay, relayAddr));

    // Attach the per-transport address registry to the sender's shared router.
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: targetId, transports: { relay: relayAddr, nkn: nknAddr } });
    sender.attachPeerGraph(graph);

    // The seam is wired: the shared router now consults the graph.
    expect(sender.peerGraph).toBe(graph);
    expect(sender.agent.routing.peerGraph).toBe(graph);

    // addressesOf resolves the transport-appropriate wire address.
    const addrs = await graph.addressesOf(targetId);
    expect(addrs).toEqual({ relay: relayAddr, nkn: nknAddr });

    // route()/selectTransport picks the higher-priority relay tier (both registered).
    const sel = await sender.agent.routing.selectTransport(targetId);
    expect(sel?.name).toBe('relay');

    // The redeem-over-relay case: target lives only on the relay bus, yet the
    // message reaches it — because relay is a registered candidate tier.
    // (onPeerMessage also surfaces the plaintext HI envelope that bootstraps the
    // handshake — the app router discriminates by payload shape — so assert on
    // the redeem payload, not the raw count.)
    await sender.peer.sendTo(targetId, { subtype: 'redeem', body: 'hi-over-relay' }, FAST);
    const redeem = await until(() => received.find((m) => m.payload?.subtype === 'redeem'));

    expect(redeem).toBeTruthy();
    expect(redeem.payload).toEqual({ subtype: 'redeem', body: 'hi-over-relay' });
    expect(redeem.from).toBe(sender.identity.pubKey);

    await sender.shutdown();
    await target.shutdown();
  });

  it('control — with ONLY the nkn tier registered (relay not a candidate), the relay-only peer is unreachable', async () => {
    const busRelay = new InternalBus();
    const busNkn   = new InternalBus();

    const received = [];
    const sender = await makeAgent();
    const target = await makeAgent((m) => received.push(m));

    const targetId = target.identity.pubKey;

    // Sender has ONLY nkn; target is on ONLY the relay bus → no shared path.
    // This is the shape the pre-slice-2 router degraded to (re-route finds only
    // nkn again), so the peer that is reachable over the relay never gets it.
    await sender.addSecureTransport('nkn', new InternalTransport(busNkn, sender.identity.pubKey));
    await target.addSecureTransport('relay', new InternalTransport(busRelay, targetId));

    await expect(
      sender.peer.sendTo(targetId, { subtype: 'redeem' }, { firstSendTimeoutMs: 200, retryDelays: [] }),
    ).rejects.toThrow(/did not respond with HI/);
    expect(received.length).toBe(0);

    await sender.shutdown();
    await target.shutdown();
  });

  it('a transport-class failure on the selected relay tier fails over to the still-reachable nkn tier', async () => {
    const busRelay = new InternalBus();
    const busNkn   = new InternalBus();

    const received = [];
    const sender = await makeAgent();
    const target = await makeAgent((m) => received.push(m));

    const targetId = target.identity.pubKey;

    // Target reachable on BOTH buses (same address — SecurityLayer keys the peer
    // pubKey by wire address, so the nkn resend must hit the address the relay HI
    // registered the key under).
    await sender.addSecureTransport('relay', new InternalTransport(busRelay, sender.identity.pubKey));
    await sender.addSecureTransport('nkn',   new InternalTransport(busNkn,   sender.identity.pubKey));
    await target.addSecureTransport('relay', new InternalTransport(busRelay, targetId));
    await target.addSecureTransport('nkn',   new InternalTransport(busNkn,   targetId));

    const graph = new PeerGraph();
    await graph.upsert({ pubKey: targetId, transports: { relay: targetId, nkn: targetId } });
    sender.attachPeerGraph(graph);

    // Let the relay HI complete (keys exchange), but make the relay ONE-WAY send
    // throw a transport-class error so the payload has to fail over to nkn.
    const relay = await sender.agent.routing.selectTransport(targetId);
    expect(relay.name).toBe('relay');
    relay.transport.sendOneWay = async () => {
      throw new Error('ECONN: relay socket closed');
    };

    const spy = vi.spyOn(sender.agent.routing, 'onTransportFailure');

    await sender.peer.sendTo(targetId, { subtype: 'redeem', body: 'failover-to-nkn' }, FAST);
    const redeem = await until(() => received.find((m) => m.payload?.subtype === 'redeem'));

    // Failover degraded the relay tier for this peer and drove the shared router.
    expect(spy).toHaveBeenCalledWith(targetId, 'relay');
    expect(sender.agent.routing.fallbackTable.isDegraded(targetId, 'relay')).toBe(true);
    // The payload arrived — over the surviving nkn tier.
    expect(redeem).toBeTruthy();
    expect(redeem.payload).toEqual({ subtype: 'redeem', body: 'failover-to-nkn' });

    spy.mockRestore();
    await sender.shutdown();
    await target.shutdown();
  });
});
