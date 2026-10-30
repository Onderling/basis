/**
 * Every shell hears that a circle changed, by construction. The box built a change feed from two composition hooks
 * (`onCircleWrite`, `onItemLanded`) and web and mobile passed neither, so nothing on a person's own devices could
 * refold a screen when an item landed: they read again on every landing instead. The agent now says it itself —
 * `agent.onCircleChanged(fn)`, fed by the same two hooks — so no shell can forget to wire it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from './support/pairRealAgents.js';

const CIRCLE_ID = 'circle-changed';

describe('the agent says a circle changed, with no hook handed to it', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('the writer hears its own write; the other node hears what landed; an unsubscribe stops it', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A', { itemsLane: true }), bootRealAgentNode('B', { itemsLane: true })]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'Changed', handle: 'changed' });
    await A.agent.ensureCircleSync?.(CIRCLE_ID);
    await B.agent.ensureCircleSync?.(CIRCLE_ID);
    expect(typeof A.agent.onCircleChanged, 'the agent offers the subscription').toBe('function');
    const onA = []; const onB = [];
    A.agent.onCircleChanged((circleId, { origin }) => onA.push({ circleId, origin }));
    const stopB = B.agent.onCircleChanged((circleId, { origin }) => onB.push({ circleId, origin }));
    await A.agent.circleStoreFor(CIRCLE_ID).put({ type: 'list-item', text: 'melk' }, { by: 'a' });
    expect(onA.find((c) => c.circleId === CIRCLE_ID && c.origin === 'own'), 'A heard its own write').toBeTruthy();
    expect(await until(async () => onB.find((c) => c.circleId === CIRCLE_ID && c.origin === 'landed') ?? null, { timeout: 5000 }),
      'B heard what landed').toBeTruthy();
    stopB();
    const n = onB.length;
    await A.agent.circleStoreFor(CIRCLE_ID).put({ type: 'list-item', text: 'brood' }, { by: 'a' });
    await new Promise((r) => { setTimeout(r, 1500); });
    expect(onB.length, 'an unsubscribed listener hears nothing more').toBe(n);
  }, 60_000);
});
