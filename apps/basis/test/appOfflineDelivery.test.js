/**
 * basis — node-level, in-process OFFLINE DELIVERY guarantee.
 *
 * The delivery guarantee (Connectivity Phase 2, the "deliver" ladder): a
 * message sent to a temporarily-unreachable peer must SURVIVE and DELIVER on
 * reconnect, not be lost or hard-errored. This exercises the local sender-hold
 * + presence-flush rung — the offline ladder's missing rung-1, with no
 * companion/pod involved — between two REAL `createRealHouseholdAgent()`
 * instances wired over a shared `InternalBus` (the pairRealAgents pattern).
 *
 * An InternalBus disconnect stands in for a peer dropping off the mesh; the
 * peer's reconnect HI is the presence signal that flushes the held queue. All
 * in-process (no NKN / relay / vite / playwright), so it runs in seconds and
 * never flakes.
 *
 * Asserts:
 *   - a send to an OFFLINE peer is HELD (not lost, not thrown) — sender reports
 *     it held, and nothing reaches the peer yet;
 *   - RECONNECT + a presence signal FLUSHES the queue — the held message(s)
 *     land in the peer's inbox;
 *   - de-dup: a repeat msgId while offline is held once and delivered once (no
 *     double-delivery), and the online path still delivers immediately.
 *
 * See test/support/pairRealAgents.js for the two-agent wiring + the
 * goOffline / goOnline helpers.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle,
  goOffline, goOnline, until, teardown,
} from './support/pairRealAgents.js';

// No HI wait / no handshake backoff — B is a known-paired peer, so we're
// exercising hold + flush, not first-contact races.
const FAST = { hold: true, firstSendTimeoutMs: 0, retryDelays: [] };

describe('offline delivery guarantee — sender-hold + presence-flush (two real agents over a shared InternalBus)', () => {
  let A; let B;

  afterAll(async () => { await teardown(A, B); });

  it('holds a send to an offline peer, then delivers it on reconnect via presence-flush, de-duped', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: 'peer-circle', name: 'Peer Circle', handle: 'peerbee' });
    // A writes to B's PERSON key: B is A's contact, added through the real door (B's card), as a person does before
    // writing someone directly (the send gate lets the person key speak to a kept contact).
    const bCard = (await B.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    expect((await A.agent.callSkill('pinboard', 'addContactFromQr', { payload: bCard }))?.error ?? null).toBe(null);

    // Warm the handshake while both are online so the later hold path isn't
    // just a first-contact HI failure (an online send delivers immediately).
    const warm = `warm ${Date.now().toString(36)}`;
    const warmRes = await A.agent.sendPeerMessage(
      B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: 'warm-1', body: warm }, FAST,
    );
    expect(warmRes.held, 'online send delivers immediately (not held)').toBe(false);
    expect(warmRes.delivered).toBe(true);
    await until(() => B.received.find((m) => m.payload?.body === warm));

    // ── B goes OFFLINE (disconnects from the shared bus). ──
    await goOffline(B);

    // A sends TWO distinct messages + a REPEAT of the first (same msgId, a
    // retry-while-offline). Each returns "held", nothing is thrown/lost.
    const body1 = `held-one ${Date.now().toString(36)}`;
    const body2 = `held-two ${Date.now().toString(36)}`;
    const r1 = await A.agent.sendPeerMessage(B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: 'm1', body: body1 }, FAST);
    const r2 = await A.agent.sendPeerMessage(B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: 'm2', body: body2 }, FAST);
    const rDup = await A.agent.sendPeerMessage(B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: 'm1', body: body1 }, FAST);

    expect(r1.held, 'send to offline peer is held, not delivered').toBe(true);
    expect(r2.held).toBe(true);
    expect(rDup.held).toBe(true);
    expect(rDup.deduped, 'a repeat msgId while offline is collapsed (held once)').toBe(true);

    // Two DISTINCT messages parked for B (the dup did not add a third).
    expect(A.agent.heldFor(B.pubKey)).toBe(2);

    // Nothing delivered to B while offline.
    expect(B.received.find((m) => m.payload?.body === body1)).toBeFalsy();
    expect(B.received.find((m) => m.payload?.body === body2)).toBeFalsy();

    // ── B RECONNECTS and announces itself (presence signal) → A flushes. ──
    await goOnline(B, { announceTo: A });

    const got1 = await until(() => B.received.find((m) => m.payload?.body === body1));
    const got2 = await until(() => B.received.find((m) => m.payload?.body === body2));
    expect(got1, 'held message 1 delivered on reconnect').toBeTruthy();
    expect(got2, 'held message 2 delivered on reconnect').toBeTruthy();
    expect(got1.from).toBe(A.pubKey);

    // The hold queue drained — nothing left parked for B.
    expect(A.agent.heldFor(B.pubKey)).toBe(0);

    // De-dup end-to-end: exactly ONE copy of each held body reached B (the
    // repeat msgId did not double-deliver).
    const copies1 = B.received.filter((m) => m.payload?.body === body1).length;
    const copies2 = B.received.filter((m) => m.payload?.body === body2).length;
    expect(copies1, 'no double-delivery of the de-duped message').toBe(1);
    expect(copies2).toBe(1);

    // A second presence signal is a no-op (queue already drained) — proves the
    // snapshot-and-clear flush can't re-deliver.
    const flush2 = await A.agent.presenceSignal(B.pubKey);
    expect(flush2.flushed).toBe(0);
    expect(B.received.filter((m) => m.payload?.body === body1).length).toBe(1);
  });
});
