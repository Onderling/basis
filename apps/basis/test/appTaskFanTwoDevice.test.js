/**
 * basis — node-level, in-process TWO-DEVICE regression for a task crossing to
 * another device's tasks surface. Guards `G-C3` (per-type sync arrival) and now
 * also `G-C1` (one store per circle) — see below.
 *
 * @guard G-C1 — a circle owns ONE store: the local write and its publisher are the same object
 * @guard G-C3 — a task fanned from one device arrives on another device's per-type tasks store
 *
 * A task created on device A must appear when device B reads its tasks. HISTORY:
 * there used to be TWO CircleItemStore instances for one circle — the tasks store
 * (`mem://tasks/circles/<id>/`, tasks-v0's own) and the household store
 * (`mem://circles/<id>/`, basis'). The tasks store was wired OUTBOUND ONLY, so a
 * fanned task was ingested only into B's household store (which the tasks surface
 * never read) and never appeared. The 2026-08-05 interim fix wired the tasks
 * store inbound too; the one-store-per-circle collapse (same day) then removed the
 * second store entirely — tasks-v0 now uses the injected household store, so the
 * tasks surface and the household store ARE the same store, synced by the single
 * `ensureCircleSync` mirror. This test crosses a real task over the wire
 * and reads it back through B's tasks surface: it can only pass if that ONE store
 * both received the fanned envelope and backs the tasks read — so it fails CI if
 * either the one-store collapse (G-C1) or the inbound wiring (G-C3) regresses.
 *
 * The task is created through the REAL app path:
 *   A.agent.callSkill('tasks','addTask',{ text, circleId })   — the tasks
 *   app-origin write that spawns/mirrors the per-circle tasks CircleItemStore.
 * and read back through the REAL app path on B:
 *   B.agent.callSkill('tasks','listOpen',{ circleId })        — reads B's tasks
 *   store, the SAME store the inbound ingest writes into.
 *
 * All in-process (one shared InternalBus — no NKN / relay / vite / playwright),
 * following the offline-delivery test's style. See test/support/pairRealAgents.js.
 *
 * NB — one faithful seam the default harness omits: the browser/mobile shells route
 * inbound peer messages through `realAgent.connectPeerTransport`, whose
 * `routedOnPeerMessage` calls `householdEnvelopeAdapter.handleInbound(from, payload)`
 * BEFORE the shell router — that is what drives a fanned item-sync envelope into the
 * receiving device's stores. The node harness wires `onPeerMessage` directly (no
 * `connectPeerTransport`, since there is no nknLib in node), so we reinstall exactly
 * that production inbound step on B here. Without it NOTHING ingests on B and the
 * test would prove nothing.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus,
  until, teardown,
} from './support/pairRealAgents.js';

// A shared circle whose tasks both devices should see.
const CIRCLE_ID = 'shared-chores';
// A known-paired peer → no first-contact HI wait / no handshake backoff needed.
const WARM = { hold: true, firstSendTimeoutMs: 2000, retryDelays: [] };

/**
 * Reinstall production's inbound step: hand every inbound peer message to the
 * household envelope adapter (`agent.householdSync.handleInbound`) BEFORE the
 * shell router — exactly what `connectPeerTransport.routedOnPeerMessage` does in
 * the browser/mobile shells. A consumed item-sync envelope returns early; anything
 * else falls through to the harness router unchanged.
 */
function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

/** Read a circle's tasks through B's real tasks surface (its tasks CircleItemStore). */
const listTasks = async (node, circleId) => {
  const res = await node.agent.callSkill('tasks', 'listOpen', { circleId });
  return Array.isArray(res?.items) ? res.items : [];
};

describe('a task created on one device reaches another device\'s TASKS store (the real callSkill fan)', () => {
  let A; let B;

  afterAll(async () => { await teardown(A, B); });

  it('crosses a task from A to B\'s tasks store — guards the tasks store being mirrored out with nothing writing the inbound back', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);
    // Reinstall the production inbound routing on B so fanned envelopes drive B's stores.
    wireInboundLikeShell(B);

    // B is a sync peer of A's tasks circle mirror, so A's task writes fan to B.
    await A.agent.addCirclePeer(CIRCLE_ID, B.pubKey);

    // Warm the handshake while both are online (so delivery is deterministic, not a
    // first-contact HI failure).
    const warm = await A.agent.sendPeerMessage(
      B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: 'warm-1', body: 'warm' }, WARM,
    );
    expect(warm.held, 'online send delivers immediately (not held)').toBe(false);
    await until(() => B.received.find((m) => m.payload?.body === 'warm'));

    // B opens the tasks circle FIRST — this wires B's tasks store inbound
    // (ensureTasksCircleMirror on B) so a fanned envelope has a listener to land in.
    // It also confirms B starts empty for this circle.
    expect(await listTasks(B, CIRCLE_ID), 'B has no tasks for the circle yet').toEqual([]);

    // A creates a task through the REAL tasks app-origin path (drives the tasks
    // CircleItemStore write + the mirror fan).
    const created = await A.agent.callSkill('tasks', 'addTask', { text: 'buy milk', circleId: CIRCLE_ID });
    expect(created?.ok, 'the real tasks addTask op succeeded').toBe(true);
    expect(created.itemId, 'addTask returned the created task id').toBeTruthy();

    // The task appears in B's TASKS store — matched by id AND text — via the fan.
    const seen = await until(async () => {
      const items = await listTasks(B, CIRCLE_ID);
      return items.find((t) => t.id === created.itemId && (t.text ?? t.title) === 'buy milk');
    });
    expect(seen, 'the task created on A reached B\'s tasks store (by id + text)').toBeTruthy();
    expect(seen.id).toBe(created.itemId);
    expect(seen.text ?? seen.title).toBe('buy milk');
  });
});
