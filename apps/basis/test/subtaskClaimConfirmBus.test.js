/**
 * The subtask claim-confirmation arc over a REAL multi-device bus (PLAN-subtask-claim-and-confirmation §7,
 * the empirical instrument). Extends the two-device task-fan harness (`appTaskFanTwoDevice.test.js`) to the
 * new ops: a task is created + claimed (auto-confirm) + decomposed on the CONTAINMENT model, and the confirmed
 * claim + the subtree must arrive intact on the other device's tasks store.
 *
 * This crosses the arc over the wire (not just two in-memory stores as `claimConfirmation.test.js` does): it
 * can only pass if the claim-confirmation fields (`confirmedAssignee`/`claimSeq`) and the containment edge
 * (`containedBy`) survive the real item-sync fan + the immutable-once-set merge on ingest.
 */
import { describe, it, expect, afterAll } from 'vitest';

import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from './support/pairRealAgents.js';

const CIRCLE_ID = 'shared-chores-claim';
const WARM = { hold: true, firstSendTimeoutMs: 2000, retryDelays: [] };

/** Reinstall production's inbound routing so fanned envelopes drive the node's stores (see appTaskFanTwoDevice). */
function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through */ }
    return shellRouter?.(env);
  };
}

const listTasks = async (node, circleId) => {
  const res = await node.agent.callSkill('tasks', 'listOpen', { circleId });
  return Array.isArray(res?.items) ? res.items : [];
};
const taskById = async (node, circleId, id) => (await listTasks(node, circleId)).find((t) => t.id === id) ?? null;

async function warm(from, to) {
  const w = await from.agent.sendPeerMessage(
    to.pubKey, { type: 'p2p-chat', subtype: 'chat-message', msgId: `warm-${to.label}`, body: 'warm' }, WARM,
  );
  expect(w.held, 'online send delivers immediately').toBe(false);
  await until(() => to.received.find((m) => m.payload?.body === 'warm'));
}

describe('subtask claim-confirmation over a real bus (§7)', () => {
  let A; let B;

  afterAll(async () => { await teardown(A, B); });

  it('a confirmed claim + its containment subtree, created on A, arrive intact on B', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A', { taskLane: true }), bootRealAgentNode('B', { taskLane: true })]);
    await connectAgentsOverBus(A, B);
    wireInboundLikeShell(A);
    wireInboundLikeShell(B);
    // A REAL join, not hand-wired peers: the signed task lane verifies the sender's key↔ref binding
    // against the circle roster, so `addCirclePeer` (a transport peer, no membership) is refused.
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'Claim circle', handle: 'bee' });
    await warm(A, B);
    await warm(B, A);

    // Both open the tasks circle so each store is wired inbound + starts empty.
    expect(await listTasks(A, CIRCLE_ID)).toEqual([]);
    expect(await listTasks(B, CIRCLE_ID)).toEqual([]);

    // A creates a root task, claims it (default = auto-confirm → confirmed in one step), and decomposes it.
    const root = await A.agent.callSkill('tasks', 'addTask', { text: 'Build shed', circleId: CIRCLE_ID });
    expect(root?.ok).toBe(true);
    await A.agent.callSkill('tasks', 'claimTask', { id: root.itemId, circleId: CIRCLE_ID });
    // Read the STORED task on A — auto-confirm must have set the confirmed claimant (survives the real store).
    const rootOnA = await taskById(A, CIRCLE_ID, root.itemId);
    expect(rootOnA?.confirmedAssignee, 'auto-confirm sets the confirmed claimant on A\'s store').toBe(A.pubKey);

    const sub = await A.agent.callSkill('tasks', 'addSubtask',
      { parentTaskId: root.itemId, text: 'Order planks', circleId: CIRCLE_ID });
    expect(sub?.queued).toBe(false);
    expect(sub?.provisional).toBeFalsy();                          // A is the confirmed claimant → committed
    expect(sub.task.containedBy).toContain(root.itemId);

    // On B: the confirmed claim on the root arrives…
    const rootOnB = await until(async () => {
      const t = await taskById(B, CIRCLE_ID, root.itemId);
      return t?.confirmedAssignee === A.pubKey ? t : null;
    }, { timeout: 8000 });
    expect(rootOnB.confirmedAssignee).toBe(A.pubKey);

    // …and the containment subtree arrives, edge intact.
    const subOnB = await until(async () => {
      const t = await taskById(B, CIRCLE_ID, sub.task.id);
      return t?.containedBy?.includes(root.itemId) ? t : null;
    }, { timeout: 8000 });
    expect(subOnB.containedBy).toContain(root.itemId);
    expect(subOnB.provisional).toBeFalsy();
  }, 60000);

  it('THE RACE — A and B claim the SAME task concurrently → both converge to ONE confirmed claimant (first-come)', async () => {
    const RACE = 'race-task';
    // A owns the task; fan it to B.
    const t = await A.agent.callSkill('tasks', 'addTask', { text: 'Contended', circleId: CIRCLE_ID, id: RACE });
    const id = t.itemId ?? RACE;
    await until(async () => await taskById(B, CIRCLE_ID, id), { timeout: 8000 });

    // Both claim in the same window (default auto-confirm → each device confirms ITSELF locally, then they sync).
    await Promise.all([
      A.agent.callSkill('tasks', 'claimTask', { id, circleId: CIRCLE_ID }),
      B.agent.callSkill('tasks', 'claimTask', { id, circleId: CIRCLE_ID }),
    ]);

    // After the fan settles, BOTH devices must agree on the SAME confirmed claimant — the immutable-once-set
    // merge resolves first-come deterministically over the wire (not last-received-wins).
    const settled = await until(async () => {
      const onA = await taskById(A, CIRCLE_ID, id);
      const onB = await taskById(B, CIRCLE_ID, id);
      if (onA?.confirmedAssignee && onB?.confirmedAssignee && onA.confirmedAssignee === onB.confirmedAssignee) {
        return { winner: onA.confirmedAssignee };
      }
      return null;
    }, { timeout: 10000 });
    expect(settled.winner, 'both devices converge to one confirmed claimant').toBeTruthy();
    expect([A.pubKey, B.pubKey]).toContain(settled.winner);
  }, 60000);

  it('EXPLICIT mode over the bus — B claims pending, A (master) confirms, B\'s device sees the confirmation', async () => {
    const EXP = 'explicit-task';
    const t = await A.agent.callSkill('tasks', 'addTask',
      { text: 'Explicit chore', circleId: CIRCLE_ID, id: EXP, claimConfirmation: 'explicit' });
    const id = t.itemId ?? EXP;
    await until(async () => await taskById(B, CIRCLE_ID, id), { timeout: 8000 });

    // B claims → PENDING (no confirmedAssignee); the pending claim fans to A.
    await B.agent.callSkill('tasks', 'claimTask', { id, circleId: CIRCLE_ID });
    const pendingOnA = await until(async () => {
      const t2 = await taskById(A, CIRCLE_ID, id);
      return t2?.assignee === B.pubKey && !t2?.confirmedAssignee ? t2 : null;
    }, { timeout: 8000 });
    expect(pendingOnA.confirmedAssignee, 'A sees B\'s claim as still pending').toBeFalsy();

    // A (the master) confirms B's claim; the confirmation crosses to B's device.
    await A.agent.callSkill('tasks', 'confirmClaim', { id, circleId: CIRCLE_ID });
    const confirmedOnB = await until(async () => {
      const t2 = await taskById(B, CIRCLE_ID, id);
      return t2?.confirmedAssignee === B.pubKey ? t2 : null;
    }, { timeout: 8000 });
    expect(confirmedOnB.confirmedAssignee).toBe(B.pubKey);
  }, 60000);
});
