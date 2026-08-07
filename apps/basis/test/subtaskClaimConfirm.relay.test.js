/**
 * The claim-confirmation RACE over a REAL RELAY (PLAN-subtask-claim-and-confirmation §7 — "bus first, then
 * relay/NKN … where the real latency makes the race and the merge rule actually bite"). The bus variant
 * (`subtaskClaimConfirmBus.test.js`) proves the arc + race in-process; this re-runs the race across a real ws
 * relay with wider timeouts, so the immutable-once-set merge is exercised under genuine transport latency.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startRelay } from '@onderling/relay';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';

const CIRCLE_ID = 'relay-race-chores';
const WARM = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };

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
  await until(() => to.received.find((m) => m.payload?.body === 'warm'), { timeout: 15000 });
  return w;
}

describe('subtask claim-confirmation race over a real relay (§7)', () => {
  let relay; let relayUrl; let A; let B;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectNodesOverRelay([A, B], { relayUrl });
    wireInboundLikeShell(A);
    wireInboundLikeShell(B);
    await A.agent.addCirclePeer(CIRCLE_ID, B.pubKey);
    await B.agent.addCirclePeer(CIRCLE_ID, A.pubKey);
    await warm(A, B);
    await warm(B, A);
  }, 90000);

  afterAll(async () => {
    try { await teardown(A, B); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  it('A and B claim the SAME task concurrently over the relay → both converge to ONE confirmed claimant', async () => {
    const t = await A.agent.callSkill('tasks', 'addTask', { text: 'Contended (relay)', circleId: CIRCLE_ID });
    const id = t.itemId;
    expect(id).toBeTruthy();
    // The task must reach B before both race to claim it.
    await until(async () => await taskById(B, CIRCLE_ID, id), { timeout: 15000 });

    await Promise.all([
      A.agent.callSkill('tasks', 'claimTask', { id, circleId: CIRCLE_ID }),
      B.agent.callSkill('tasks', 'claimTask', { id, circleId: CIRCLE_ID }),
    ]);

    const settled = await until(async () => {
      const onA = await taskById(A, CIRCLE_ID, id);
      const onB = await taskById(B, CIRCLE_ID, id);
      if (onA?.confirmedAssignee && onB?.confirmedAssignee && onA.confirmedAssignee === onB.confirmedAssignee) {
        return { winner: onA.confirmedAssignee };
      }
      return null;
    }, { timeout: 20000 });
    expect(settled.winner, 'both devices converge to one confirmed claimant over the relay').toBeTruthy();
    expect([A.pubKey, B.pubKey]).toContain(settled.winner);
  }, 60000);
});
