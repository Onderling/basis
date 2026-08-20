/**
 * basis — node-level, in-process OFFLINE DELIVERY for a REAL circle task, on the SIGNED LANE.
 *
 * appOfflineDelivery.test.js proves the hold-forward rung at the raw send level. THIS test proves the
 * guarantee is carried END-TO-END by the APP on the lane the production shells actually use: a task
 * written through the real `callSkill` path rides the signed task lane (`broadcastCircleTask` →
 * `broadcastToCircle`, whose sends carry `guarantee:'hold-forward'` at the fan, not per call site) to
 * every member's per-circle address. A member who is briefly offline has the STATEMENT held and
 * delivered on reconnect — and the assertion is made where it matters: the task appears in the offline
 * member's own TASKS STORE head (what their task list shows), not merely in a transport inbox.
 *
 * (This file used to drive the same scenario over the legacy unsigned mirror to `addCirclePeer`
 * transport-peers. The lane verifies senders against the circle ROSTER, so the conversion goes through
 * a REAL join — `pairCircle` — and the fan now targets per-circle addresses, which is where the hold
 * queue is observed. The lane's second convergence rung, catch-up replay, has its own tests; this one
 * pins the held-fan rung.)
 *
 * An InternalBus disconnect stands in for B dropping off the mesh; B's reconnect HI is the presence
 * signal that flushes the held queue. All in-process, runs in seconds.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle,
  goOffline, goOnline, until, teardown,
} from './support/pairRealAgents.js';

const CIRCLE_ID = 'offline-chores';
// A known-paired peer → no first-contact HI wait / no handshake backoff needed.
const WARM = { hold: true, firstSendTimeoutMs: 2000, retryDelays: [] };

/** Production's inbound step (see appTaskFanTwoDevice.test.js): item-sync envelopes feed the stores
 *  BEFORE the shell router, exactly as `connectPeerTransport.routedOnPeerMessage` does in the shells. */
function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

const listTasks = async (node, circleId) => {
  const res = await node.agent.callSkill('tasks', 'listOpen', { circleId });
  return Array.isArray(res?.items) ? res.items : [];
};

describe('offline delivery for a REAL circle task on the signed lane (held at the fan, landing in the member\'s tasks store)', () => {
  let A; let B;

  afterAll(async () => { await teardown(A, B); });

  it('holds a task added while a member is offline, then delivers it into their TASKS STORE on reconnect', async () => {
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }),
      bootRealAgentNode('B', { taskLane: true }),
    ]);
    await connectAgentsOverBus(A, B);
    wireInboundLikeShell(B);

    // A REAL join — the lane verifies the sender's key↔ref binding against the circle roster,
    // so a hand-wired transport peer would be refused, correctly.
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'Offline chores', handle: 'bee' });

    // Warm the handshake while both are online so the later hold is a real offline-hold.
    const warm = await A.agent.sendPeerMessage(
      B.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: 'warm-1', body: 'warm' }, WARM,
    );
    expect(warm.held, 'online send delivers immediately (not held)').toBe(false);
    await until(() => B.received.find((m) => m.payload?.body === 'warm'));

    // Baseline: an ONLINE task crosses into B's tasks store via the lane.
    const onlineTask = await A.agent.callSkill('tasks', 'addTask', { text: 'sweep the hall', circleId: CIRCLE_ID });
    expect(onlineTask?.ok, 'the real addTask op succeeded').toBe(true);
    await until(async () => (await listTasks(B, CIRCLE_ID)).find((t) => t.id === onlineTask.itemId));

    // ── B goes OFFLINE. ──
    await goOffline(B);

    const offlineTask = await A.agent.callSkill('tasks', 'addTask', { text: 'water the plants', circleId: CIRCLE_ID });
    expect(offlineTask?.ok, 'addTask still succeeds locally while a member is offline').toBe(true);

    // The lane fans to B's PER-CIRCLE address — that is where the statement must be held.
    const bCircleAddr = B.agent.circleAddressFor(CIRCLE_ID);
    await until(() => A.agent.heldFor(bCircleAddr) > 0, { timeout: 1500 });
    expect(A.agent.heldFor(bCircleAddr), 'the fan to the offline member is held, not dropped').toBeGreaterThan(0);
    expect(
      (await listTasks(B, CIRCLE_ID)).some((t) => t.id === offlineTask.itemId),
      'nothing reached B\'s store while offline',
    ).toBe(false);

    // ── B RECONNECTS and announces itself → A flushes; B's rail ingests; the head converges. ──
    await goOnline(B, { announceTo: A });

    const seen = await until(async () =>
      (await listTasks(B, CIRCLE_ID)).find((t) => t.id === offlineTask.itemId));
    expect(seen, 'the held task landed in B\'s tasks store on reconnect').toBeTruthy();
    expect(seen.text ?? seen.title).toBe('water the plants');

    // The hold queue drained — nothing left parked for B's circle address.
    expect(A.agent.heldFor(bCircleAddr)).toBe(0);
  });
});
