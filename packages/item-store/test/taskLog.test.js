/**
 * The task-log cutover: a task crosses devices VIA THE LOG.
 *
 * The old store-mirror sync (createTaskStore.applySync) starts by finding a LOCAL
 * mirror and returns null when there is none — so a task created on one device never
 * lands on a device that never saw it (the three-device fan-out gap). These tests drive
 * transitions on one store, ship the log entries to another via `applyLogEntry`, and
 * assert the second device's head converges — INCLUDING a create it never mirrored.
 *
 * The `applyLogEntry(entry)` wire here stands in for the peer transport; the point is the
 * RECORD (the entries replayed through the real verbs), not the pipe that carries them.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { createTaskStore } from '../src/createTaskStore.js';

const ALICE = 'webid:alice';
const BOB = 'webid:bob';

const mkStore = () => createTaskStore(new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c/' }));

/** Replay every entry `from` holds onto `to` (idempotent via the store's dedup). In order. */
async function syncLog(from, to) {
  for (const entry of from.taskLog()) await to.applyLogEntry(entry);
}

/** The head, reduced to the fields that define a task's state, sorted by id. */
async function headOf(store) {
  const open = await store.listOpen();
  const closed = await store.listClosed();
  return [...open, ...closed]
    .map((i) => ({ id: i.id, text: i.text, assignee: i.assignee ?? null, completed: !!i.completedAt }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe('task-log cutover — a task crosses devices via the log', () => {
  it('a task CREATED on device A lands on device C that never mirrored it (the fan-out fix)', async () => {
    const a = mkStore();
    const c = mkStore();

    const [task] = await a.addItems([{ text: 'buy milk' }], { actor: ALICE });
    // C has never heard of this task — the old store-mirror would have nothing to merge onto.
    expect(await c.getById(task.id)).toBeNull();

    await syncLog(a, c);

    const onC = await c.getById(task.id);
    expect(onC?.text).toBe('buy milk');
    expect(onC?.id).toBe(task.id);          // same canonical id on both devices
  });

  it('a full claim→complete lifecycle converges: both devices reach the SAME head', async () => {
    const a = mkStore();
    const b = mkStore();

    // Alice creates on A; Bob (on B) learns of it, claims it, completes it; A learns that back.
    const [task] = await a.addItems([{ text: 'take out bins' }], { actor: ALICE });
    await syncLog(a, b);

    await b.claim(task.id, { actor: BOB });
    await b.markComplete([task.id], { actor: BOB });
    await syncLog(b, a);

    const onA = await a.getById(task.id);
    expect(onA?.assignee).toBe(BOB);
    expect(!!onA?.completedAt).toBe(true);
    expect(await headOf(a)).toEqual(await headOf(b));   // converged
  });

  it('re-delivering the whole log is idempotent — no duplicate tasks, no state churn', async () => {
    const a = mkStore();
    const c = mkStore();

    await a.addItems([{ text: 'water plants' }], { actor: ALICE });
    await syncLog(a, c);
    const once = await headOf(c);

    await syncLog(a, c);   // deliver everything a second time
    await syncLog(a, c);   // and a third
    expect(await headOf(c)).toEqual(once);
    expect((await c.listOpen()).length).toBe(1);   // exactly one task, not three
  });

  it('an inbound entry NEVER echoes back to the mesh (ingest writes are sync:false)', async () => {
    const store = new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c/' });
    const published = [];
    store.setSyncHook({ publishItem: (item) => published.push(item), removeItem: () => {} });
    const c = createTaskStore(store);

    const a = mkStore();
    const [task] = await a.addItems([{ text: 'no echo' }], { actor: ALICE });
    await syncLog(a, c);

    expect(await c.getById(task.id)).toBeTruthy();   // it DID land
    expect(published).toEqual([]);                   // …without re-publishing (no echo loop)
  });

  it('an out-of-order entry (claim before its create) is left un-folded, then applies on retry', async () => {
    const a = mkStore();
    const c = mkStore();

    const [task] = await a.addItems([{ text: 'paint fence' }], { actor: ALICE });
    await a.claim(task.id, { actor: ALICE });
    const log = a.taskLog();
    const createEntry = log.find((e) => e.event === 'create');
    const claimEntry = log.find((e) => e.event === 'claim');

    // Claim arrives first — its target doesn't exist yet, so it must not throw and must not "stick".
    expect(await c.applyLogEntry(claimEntry)).toBeNull();
    expect(await c.getById(task.id)).toBeNull();

    // Now the create lands, then the claim re-delivers and takes.
    await c.applyLogEntry(createEntry);
    await c.applyLogEntry(claimEntry);
    expect((await c.getById(task.id))?.assignee).toBe(ALICE);
  });
});
