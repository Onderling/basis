/**
 * A save waiting on its debounce is made at once when the shell flushes on exit (a reload, a closed tab, an app sent
 * to the background) — a change in the last fifth of a second is not lost. Over an in-memory IndexedDB, as on web.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { flushPendingSaves, pendingSaveCount } from '@onderling/local-store';
import { buildHouseholdDataSource } from '../../household/src/storage/persist.js';

describe('a waiting save, flushed on exit', () => {
  it('is in IndexedDB right after the flush — before its timer would have run', async () => {
    const db = { dbName: 'flush-on-exit-t1', storeName: 'items', saveDelayMs: 60_000 };
    const ds = await buildHouseholdDataSource(db);
    await ds.write('mem://own/x/items/a.json', JSON.stringify({ title: 'tandarts' }));
    expect(pendingSaveCount()).toBeGreaterThan(0);
    await flushPendingSaves();
    const again = await buildHouseholdDataSource(db);
    expect(await again.read('mem://own/x/items/a.json')).toContain('tandarts');
  });

  it('a save that ran on its own timer is no longer waiting', async () => {
    const ds = await buildHouseholdDataSource({ dbName: 'flush-on-exit-t2', storeName: 'items', saveDelayMs: 10 });
    await ds.write('k', 'v');
    await new Promise((r) => setTimeout(r, 50));
    expect(pendingSaveCount()).toBe(0);
  });
});

describe('a cancelled save is not flushed on exit', () => {
  it('cancel() untracks the waiting save', async () => {
    const { IndexedDBPersist } = await import('../../stoop/src/lib/IndexedDBPersist.js');
    const p = new IndexedDBPersist({ dbName: 'flush-on-exit-cancel', saveDelayMs: 60_000 });
    const before = pendingSaveCount();
    p.scheduleSave(new Map([['a', 1]]));
    expect(pendingSaveCount()).toBe(before + 1);
    p.cancel();
    expect(pendingSaveCount()).toBe(before);
  });
});

describe('the device log flushes on exit', () => {
  it('a debounced log save waits in the registry and lands on flush', async () => {
    const { wireEventLogPersistence } = await import('../src/v2/eventLogPersistence.js');
    const saved = [];
    let persist = null;
    const eventLog = { hydrate: () => 0, setPersist: (fn) => { persist = fn; } };
    await wireEventLogPersistence({ eventLog, io: { load: async () => null, save: async (ev) => { saved.push(ev); } }, debounceMs: 60_000 });
    await persist([{ id: 'e1' }]);
    expect(saved).toEqual([]);
    expect(pendingSaveCount()).toBeGreaterThan(0);
    await flushPendingSaves();
    expect(saved).toEqual([[{ id: 'e1' }]]);
  });
});
