/**
 * A MESSAGE WRITTEN IN THE FIRST SECOND — before the relay socket is open — still goes.
 *
 * Boot does not wait for the relay on purpose (a relay that is down must not stall the app), so for a
 * moment after launch a device has a relay transport whose socket is still opening. A send in that
 * moment could not route and was HELD — correctly — but nothing ever flushed it: presence flushes are
 * per peer and fire on THAT peer's inbound, so the hold sat until the contact happened to write first.
 * And it was labelled `no-eligible-route` ("this circle's route cannot carry it", an offer to accept
 * the address fallback) rather than "offline", because the unscoped route under a pinned transport
 * mode names the relay whether or not its socket is open.
 *
 * Found 2026-09-13 by the alpha feedback walk: a fresh install wrote to its seeded contact right after
 * boot and the feedback parked. Now the socket opening flushes what it made sendable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';

const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };
const textsAt = (node) => node.received.map((m) => m?.payload?.text).filter(Boolean);

describe('a send before the relay socket is open', () => {
  let relay; let bea; let fresh;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    bea = await bootRealAgentNode('bea');
    await bea.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => bea._routerRef.fn?.(env), awaitRelayReady: true });
  }, 60_000);
  afterAll(async () => { await teardown(bea, fresh); try { await relay?.close?.(); } catch { /* */ } });

  it('is held — and goes the moment the socket opens, with nobody else doing anything', async () => {
    fresh = await bootRealAgentNode('fresh');
    // The person writes BEFORE the relay is up — the deterministic form of "in the first second".
    const r = await fresh.agent.sendPeerMessage(bea.pubKey, { type: 'p2p-chat', msgId: 'first-second', ts: Date.now(), text: 'hoi, meteen na het opstarten' }, SEND);
    expect(r?.held, 'with no wire yet the send must be held, not lost or reported delivered').toBe(true);
    expect(r.reason, 'no wire is "offline", never "no route this circle may use"').toBe('unreachable');
    // Then the production boot: connect requested, not awaited. Bea does nothing — the socket opening
    // is the only event, and it must be enough.
    await connectNodesOverRelay([fresh], { relayUrl: relay.url });
    const arrived = await until(async () => (textsAt(bea).includes('hoi, meteen na het opstarten') ? true : null), { timeout: 15_000, step: 100 });
    expect(arrived, 'the message written before the socket opened never went — the socket opening flushed nothing').toBe(true);
  }, 60_000);
});
