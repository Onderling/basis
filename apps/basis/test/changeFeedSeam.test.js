/**
 * The change seam, crossed: two real nodes in one circle over the real transport. What one writes reaches the other's
 * composition as an item that LANDED (`onItemLanded`, fed by the task rail's one seam), and the writer's composition
 * hears its own write WITH the item (`onCircleWrite`) — the two inputs of a host's change feed.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from './support/pairRealAgents.js';

const CIRCLE_ID = 'change-seam';

describe('the change seam between two real nodes', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('a write on one node lands on the other as a change its composition hears; the writer hears its own', async () => {
    const wroteA = [];
    const landedB = [];
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true, agentOpts: { onCircleWrite: (circleId, item, removedId) => wroteA.push({ circleId, id: item?.id ?? null, removedId: removedId ?? null }) } }),
      bootRealAgentNode('B', { taskLane: true, agentOpts: { onItemLanded: (circleId, item) => landedB.push({ circleId, id: item?.id, title: item?.title }) } }),
    ]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'Seam', handle: 'seam' });
    await A.agent.ensureCircleSync?.(CIRCLE_ID);
    await B.agent.ensureCircleSync?.(CIRCLE_ID);
    const made = await A.agent.circleStoreFor(CIRCLE_ID).put({ type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-12T12:00:00.000Z' }, { by: 'a' });
    const landed = await until(async () => landedB.find((l) => l.id === made.id), { timeout: 5000 });
    expect(landed, 'B\'s composition heard the item land').toEqual({ circleId: CIRCLE_ID, id: made.id, title: 'tandarts' });
    expect(wroteA.find((w) => w.id === made.id), 'A\'s composition heard its own write, with the item').toEqual({ circleId: CIRCLE_ID, id: made.id, removedId: null });
  }, 60_000);
});
