/**
 * podRecovery (Objective S) — recover a circle's pod content by merging N device caches.
 * Proves: union by id with the causal winner kept (older never clobbers newer), order-independence over any
 * permutation of caches, partial/missing caches still recover, deterministic concurrent-edit tiebreak, and the
 * empty/one-cache edges. Also the injected write-back seam (`writeRecoveredInto`) preserves causal metadata.
 * The causal coordinate is the Lamport `clock` (#33), not the wall clock.
 */
import { describe, it, expect } from 'vitest';
import { recoverCircleFromCaches, writeRecoveredInto } from '../src/podRecovery.js';
import { createCircleStores } from '../src/circleStores.js';
import { memoryDataSource } from '../src/memoryDataSource.js';

// A minimal item as a device cache would hold it: id + type + causal coordinate (Lamport `clock` + `updatedBy`).
const item = (id, clock, updatedBy = 'w', extra = {}) =>
  ({ id, type: 'task', text: id, clock, updatedBy, ...extra });

const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

describe('recoverCircleFromCaches — causal merge of device caches', () => {
  it('unions items across caches by id and keeps the causal winner (older never clobbers newer)', async () => {
    const cacheA = [item('a', 1), item('b', 1)];
    const cacheB = [item('a', 3), item('c', 1)]; // newer 'a' (higher clock)
    const { items, stats } = await recoverCircleFromCaches([cacheA, cacheB]);
    const m = byId(items);
    expect(Object.keys(m).sort()).toEqual(['a', 'b', 'c']);     // union of ids
    expect(m.a.clock).toBe(3);             // newer 'a' won
    expect(stats.recovered).toBe(3);
    expect(stats.conflicts).toBe(1);       // 'a' collided once
    expect(stats.replacements).toBe(1);    // newer 'a' beat the older one
  });

  it('is ORDER-INDEPENDENT: any permutation of caches yields the same recovered state', async () => {
    const c1 = [item('x', 3000), item('y', 1000)];
    const c2 = [item('x', 1000), item('z', 5000)];
    const c3 = [item('y', 4000), item('x', 2000)];
    const perms = [
      [c1, c2, c3], [c1, c3, c2], [c2, c1, c3],
      [c2, c3, c1], [c3, c1, c2], [c3, c2, c1],
    ];
    const results = await Promise.all(perms.map((p) => recoverCircleFromCaches(p)));
    const norm = (r) => byId(r.items);
    const expected = { x: 3000, y: 4000, z: 5000 };  // causal max per id
    for (const r of results) {
      const m = norm(r);
      expect(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.clock]))).toEqual(expected);
    }
  });

  it('recovers from a PARTIAL subset of devices (missing item contributes nothing)', async () => {
    // Only device B has item 'c'; device A never saw it. Recovery from both still yields 'c'.
    const cacheA = [item('a', 2000)];
    const cacheB = [item('a', 1000), item('c', 9000)];
    const { items } = await recoverCircleFromCaches([cacheA, cacheB]);
    const m = byId(items);
    expect(Object.keys(m).sort()).toEqual(['a', 'c']);
    expect(m.a.clock).toBe(2000);   // A's newer 'a'
    expect(m.c.clock).toBe(9000);   // recovered solely from B

    // Recovering from ONLY the subset {B} still yields B's best-known state.
    const only = await recoverCircleFromCaches([cacheB]);
    expect(byId(only.items).c.clock).toBe(9000);
  });

  it('skips null/missing caches gracefully', async () => {
    const { items, stats } = await recoverCircleFromCaches([null, [item('a', 1)], undefined]);
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(stats.caches).toBe(1);   // only the one real cache counted
  });

  it('resolves a CONCURRENT edit (equal clock) by the deterministic writer-id tiebreak', async () => {
    const cacheA = [item('a', 5000, 'alice')];
    const cacheB = [item('a', 5000, 'bob')];   // same clock, different writer → higher id wins
    const one = await recoverCircleFromCaches([cacheA, cacheB]);
    const two = await recoverCircleFromCaches([cacheB, cacheA]);   // reversed order
    expect(byId(one.items).a.updatedBy).toBe('bob');
    expect(byId(two.items).a.updatedBy).toBe('bob');   // same survivor regardless of order
  });

  it('clockless copy falls back gracefully without crashing', async () => {
    const cacheA = [item('a', 5000, 'w'), { id: 'b', type: 'task', text: 'no-clock' }];
    const cacheB = [{ id: 'c', type: 'task' }];
    const { items, stats } = await recoverCircleFromCaches([cacheA, cacheB]);
    expect(items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    expect(stats.malformed).toBe(0);   // clockless is still a valid id-bearing item
  });

  it('edge cases: empty input, empty caches, malformed items', async () => {
    expect((await recoverCircleFromCaches([])).items).toEqual([]);
    expect((await recoverCircleFromCaches(undefined)).items).toEqual([]);
    expect((await recoverCircleFromCaches([[], []])).stats.recovered).toBe(0);

    const { items, stats } = await recoverCircleFromCaches([[item('a', 1), null, { type: 'task' }, 42]]);
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(stats.malformed).toBe(3);   // null, id-less object, and the non-object
  });

  it('a single cache recovers itself unchanged', async () => {
    const cache = [item('a', 1), item('b', 2)];
    const { items, stats } = await recoverCircleFromCaches([cache]);
    expect(items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(stats.conflicts).toBe(0);
  });

  it('reads STORE-LIKE caches (CircleItemStore.list) as well as raw arrays', async () => {
    // Build two device stores over independent DataSources, seed overlapping/conflicting items (with clocks).
    const devA = createCircleStores({ dataSource: memoryDataSource() }).getStore('circle-1');
    const devB = createCircleStores({ dataSource: memoryDataSource() }).getStore('circle-1');
    await devA.put({ id: 'a', type: 'task', text: 'A-old', clock: 1 }, { origin: true });
    await devB.put({ id: 'a', type: 'task', text: 'B-new', clock: 5 }, { origin: true });
    await devB.put({ id: 'b', type: 'task', text: 'only-on-B', clock: 2 }, { origin: true });

    const { items } = await recoverCircleFromCaches([devA, devB]);
    const m = byId(items);
    expect(Object.keys(m).sort()).toEqual(['a', 'b']);
    expect(m.a.text).toBe('B-new');   // higher-clock write recovered from device B
  });
});

describe('writeRecoveredInto — injected write-back seam (preserves causal metadata)', () => {
  it('writes recovered winners into a fresh store with origin:true', async () => {
    const recovered = [
      item('a', 5, 'bob'),
      item('b', 2, 'alice'),
    ];
    const fresh = createCircleStores({ dataSource: memoryDataSource() }).getStore('circle-1');
    const { written } = await writeRecoveredInto(fresh, recovered);
    expect(written).toBe(2);

    const back = byId(await fresh.list());
    expect(Object.keys(back).sort()).toEqual(['a', 'b']);
    expect(back.a.clock).toBe(5);   // origin clock PRESERVED, not re-stamped
    expect(back.a.updatedBy).toBe('bob');
  });

  it('write-back causal guard: an older recovered copy never clobbers a newer one already in the target', async () => {
    const fresh = createCircleStores({ dataSource: memoryDataSource() }).getStore('circle-1');
    await fresh.put({ id: 'a', type: 'task', text: 'newer', clock: 10 }, { origin: true });
    await writeRecoveredInto(fresh, [item('a', 1, 'w', { text: 'older' })]);
    expect(byId(await fresh.list()).a.text).toBe('newer');   // store's causal guard kept the newer copy
  });

  it('rejects a target without put()', async () => {
    await expect(writeRecoveredInto({}, [])).rejects.toThrow(/put/);
  });
});
