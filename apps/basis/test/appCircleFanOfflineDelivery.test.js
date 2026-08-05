/**
 * basis — node-level, in-process OFFLINE DELIVERY for a REAL circle-content fan.
 *
 * appOfflineDelivery.test.js proves the hold-forward rung at the raw send level
 * (`agent.sendPeerMessage(...)` with an explicit `hold` opt). THIS test proves the
 * guarantee is now carried END-TO-END by the APP: a durable circle-content op —
 * `household.addTask` (a task/noticeboard item) — dispatched through the real
 * `callSkill` path fans out to the circle's members over the secure-mesh item-sync
 * mirror (`createSecureMeshEnvelopeAdapter` → `sa.peer.sendTo`), and that fan now
 * carries `guarantee:'hold-forward'` BY DEFAULT (wired once at the adapter, not per
 * call site). So a member who is briefly offline has the item HELD and delivered on
 * reconnect — without the caller ever passing an opt.
 *
 * The test drives the op, NOT `sa.peer.sendTo` directly:
 *   A.agent.addCirclePeer(circle, B)  — B is a sync peer of A's circle store.
 *   A.agent.callSkill('household','addTask',…)  — the REAL app write → mirror fan.
 *
 * An InternalBus disconnect stands in for B dropping off the mesh; B's reconnect HI
 * is the presence signal that flushes the held queue. All in-process (no NKN / relay
 * / vite / playwright), so it runs in seconds and never flakes.
 *
 * Asserts:
 *   - the item-sync envelope for a task added while B is OFFLINE is HELD by A (not
 *     lost, not thrown) — A reports a non-empty hold queue for B and nothing reaches B;
 *   - RECONNECT + a presence signal FLUSHES it — the held household-item envelope
 *     (carrying the created item's id) lands in B's inbox and A's queue drains.
 *
 * See test/support/pairRealAgents.js for the two-agent wiring + goOffline/goOnline.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus,
  goOffline, goOnline, until, teardown,
} from './support/pairRealAgents.js';

// The peer-message key the secure-mesh item-sync mirror namespaces its envelopes
// under (createSecureMeshEnvelopeAdapter's default `tag`).
const NTFY = '__ntfyEnv';
// A known-paired peer → no first-contact HI wait / no handshake backoff needed.
const WARM = { hold: true, firstSendTimeoutMs: 2000, retryDelays: [] };

/** All household-item sync envelopes B has received so far. */
const itemEnvelopes = (node) =>
  node.received.filter((m) => m?.payload?.[NTFY]?.kind === 'household-item');

describe('offline delivery for a REAL circle-content fan (household.addTask over the secure-mesh item-sync mirror)', () => {
  let A; let B;

  afterAll(async () => { await teardown(A, B); });

  it('holds a task added while a circle member is offline, then delivers it on reconnect — via the real callSkill fan, no opt at the call site', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);

    // B is a sync peer of A's default circle store, so A's item writes fan to B.
    await A.agent.addCirclePeer('household', B.pubKey);

    // Warm the handshake while both are online (so the later hold path is a real
    // offline-hold, not a first-contact HI failure) and prove online item fan-out
    // delivers immediately.
    const warm = await A.agent.sendPeerMessage(
      B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: 'warm-1', body: 'warm' }, WARM,
    );
    expect(warm.held, 'online send delivers immediately (not held)').toBe(false);
    await until(() => B.received.find((m) => m.payload?.body === 'warm'));

    const onlineTask = await A.agent.callSkill('household', 'addTask', { text: 'sweep the hall', circleId: 'household' });
    expect(onlineTask?.ok, 'the real addTask op succeeded').toBe(true);
    await until(() => itemEnvelopes(B).some((m) => JSON.stringify(m.payload[NTFY]).includes(onlineTask.itemId)));
    expect(
      itemEnvelopes(B).some((m) => JSON.stringify(m.payload[NTFY]).includes(onlineTask.itemId)),
      'online task fanned to B immediately',
    ).toBe(true);

    // ── B goes OFFLINE (disconnects from the shared bus). ──
    await goOffline(B);
    const heldBefore = itemEnvelopes(B).length;

    // A adds a task through the REAL op path while B is offline. No hold opt is
    // passed here — the guarantee is baked into the mirror's fan.
    const offlineTask = await A.agent.callSkill('household', 'addTask', { text: 'water the plants', circleId: 'household' });
    expect(offlineTask?.ok, 'addTask still succeeds locally while a member is offline').toBe(true);

    // The item-sync envelope for it is HELD by A (its queue for B is non-empty),
    // and nothing new reached B.
    await until(() => A.agent.heldFor(B.pubKey) > 0, { timeout: 1500 });
    expect(A.agent.heldFor(B.pubKey), 'the fan to the offline member is held, not dropped').toBeGreaterThan(0);
    expect(itemEnvelopes(B).length, 'nothing delivered to B while offline').toBe(heldBefore);

    // ── B RECONNECTS and announces itself (presence signal) → A flushes. ──
    await goOnline(B, { announceTo: A });

    const delivered = await until(
      () => itemEnvelopes(B).find((m) => JSON.stringify(m.payload[NTFY]).includes(offlineTask.itemId)),
    );
    expect(delivered, 'the held task item is delivered to B on reconnect').toBeTruthy();

    // The hold queue drained — nothing left parked for B.
    expect(A.agent.heldFor(B.pubKey)).toBe(0);
  });
});
