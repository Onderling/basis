/**
 * The loop rule across hosts: a write made by a fired planned row carries its origin (`origin: { intention: <row> }`),
 * and the change feed drops such a change — the host's own and one that lands on another node — so an event row whose
 * op writes never fires again anywhere. Two real nodes over the real transport; the writer's origin is ambient for the
 * run (AsyncLocalStorage on node), never a field an op has to remember.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from './support/pairRealAgents.js';
import { createChangeFeed } from '../src/v2/changeFeed.js';

const CIRCLE_ID = 'origin-seam';

describe('a write made by a fired row, between two real nodes', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('carries its origin across, and neither node\'s change feed passes it on; a plain write is passed on', async () => {
    const running = new AsyncLocalStorage();
    const heardA = [];
    const heardB = [];
    const feeds = {};
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true, agentOpts: { writeOrigin: () => running.getStore() ?? null, onCircleWrite: (c, item) => feeds.A?.own(c, item) } }),
      bootRealAgentNode('B', { taskLane: true, agentOpts: { onItemLanded: (c, item) => feeds.B?.landed(c, item) } }),
    ]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'Origin', handle: 'origin' });
    await A.agent.ensureCircleSync?.(CIRCLE_ID);
    await B.agent.ensureCircleSync?.(CIRCLE_ID);
    feeds.A = createChangeFeed({ storeFor: (id) => A.agent.circleStoreFor(id), consumers: [(c) => heardA.push(c.after?.title)] });
    feeds.B = createChangeFeed({ storeFor: (id) => B.agent.circleStoreFor(id), consumers: [(c) => heardB.push(c.after?.title)] });
    await feeds.A.seedAll([CIRCLE_ID]);
    await feeds.B.seedAll([CIRCLE_ID]);
    const storeA = A.agent.circleStoreFor(CIRCLE_ID);
    const storeB = B.agent.circleStoreFor(CIRCLE_ID);

    const fired = await running.run({ intention: 'row-1' }, () => storeA.put({ type: 'calendar-event', title: 'by a row', startsAt: '2026-10-12T12:00:00.000Z' }, { by: 'a' }));
    expect(fired.origin, 'the write made inside a run carries the row').toEqual({ intention: 'row-1' });
    const landed = await until(async () => (await storeB.get(fired.id)) ?? null, { timeout: 5000 });
    expect(landed?.origin, 'the origin travels with the item').toEqual({ intention: 'row-1' });

    const plain = await storeA.put({ type: 'calendar-event', title: 'by a person', startsAt: '2026-10-12T13:00:00.000Z' }, { by: 'a' });
    expect(plain.origin).toBeUndefined();
    await until(async () => (heardB.includes('by a person') ? true : null), { timeout: 5000 });
    expect(heardA, 'the writer\'s own feed drops the row\'s write').toEqual(['by a person']);
    expect(heardB, 'the other node\'s feed drops it too').toEqual(['by a person']);

    // a person's later edit of the row's item is a person's change again: no origin, passed on
    const edited = await storeA.put({ ...fired, title: 'by a row, edited' }, { by: 'a' });
    expect(edited.origin).toBeUndefined();
  }, 60_000);
});
