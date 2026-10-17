/**
 * AsyncStoragePersist — unit tests.
 *
 * Uses an in-memory mock AsyncStorage so vitest can exercise the
 * full load / save / debounce / flush / cancel surface without a
 * real RN runtime.
 *
 * Mirrors the coverage IndexedDBPersist.test.js + FilePersist tests
 * give those two adapters.
 *
 * Task (2026-05-24).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AsyncStoragePersist } from '../src/lib/AsyncStoragePersist.js';

function makeMockAsyncStorage() {
  const store = new Map();
  return {
    _store: store,
    async getItem(k)    { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, String(v)); },
    async removeItem(k) { store.delete(k); },
  };
}

describe('AsyncStoragePersist — construction', () => {
  it('throws when dbName missing', () => {
    expect(() => new AsyncStoragePersist({ asyncStorage: makeMockAsyncStorage() }))
      .toThrow(/dbName required/);
  });

  it('throws when asyncStorage is not a valid object', () => {
    expect(() => new AsyncStoragePersist({ dbName: 'x', asyncStorage: {} }))
      .toThrow(/getItem/);
  });

  it('accepts injected mock AsyncStorage', () => {
    const ms = makeMockAsyncStorage();
    expect(() => new AsyncStoragePersist({ dbName: 'cc-pinboard-cache', asyncStorage: ms }))
      .not.toThrow();
  });
});

describe('AsyncStoragePersist — load + save', () => {
  let storage; let persist;
  beforeEach(() => {
    storage = makeMockAsyncStorage();
    persist = new AsyncStoragePersist({ dbName: 'test-cache', asyncStorage: storage });
  });

  it('cold load returns empty Map', async () => {
    const m = await persist.load();
    expect(m).toBeInstanceOf(Map);
    expect(m.size).toBe(0);
  });

  it('save then load round-trips a Map', async () => {
    const m1 = new Map([['k1', 'v1'], ['k2', { nested: true }]]);
    await persist.save(m1);

    // New persist instance reads the same key.
    const persist2 = new AsyncStoragePersist({ dbName: 'test-cache', asyncStorage: storage });
    const m2 = await persist2.load();
    expect([...m2.entries()].sort()).toEqual([
      ['k1', 'v1'],
      ['k2', { nested: true }],
    ]);
  });

  it('corrupt JSON load returns empty Map (silent recovery)', async () => {
    await storage.setItem('pinboard-cache:test-cache::state', '{ not valid json');
    const m = await persist.load();
    expect(m.size).toBe(0);
  });

  it('save is a no-op when the serialised blob is unchanged', async () => {
    const m = new Map([['a', 1]]);
    await persist.save(m);
    const writes1 = storage._store.size;
    await persist.save(m);                       // identical second save
    expect(storage._store.size).toBe(writes1);  // no extra entry
  });
});

describe('AsyncStoragePersist — debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('scheduleSave debounces multiple bursts into one write', async () => {
    const storage = makeMockAsyncStorage();
    const persist = new AsyncStoragePersist({
      dbName: 'd', asyncStorage: storage, saveDelayMs: 50,
    });

    persist.scheduleSave(new Map([['a', 1]]));
    persist.scheduleSave(new Map([['a', 2]]));
    persist.scheduleSave(new Map([['a', 3]]));
    expect(storage._store.size).toBe(0);

    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    // Only the LAST scheduled value was persisted.
    const raw = await storage.getItem('pinboard-cache:d::state');
    expect(JSON.parse(raw)).toEqual({ a: 3 });
  });

  it('flush writes pending state immediately + cancels the timer', async () => {
    vi.useRealTimers();
    const storage = makeMockAsyncStorage();
    const persist = new AsyncStoragePersist({
      dbName: 'd', asyncStorage: storage, saveDelayMs: 10_000, // long
    });
    persist.scheduleSave(new Map([['x', 'pending']]));
    await persist.flush(new Map([['x', 'flushed']]));
    const raw = await storage.getItem('pinboard-cache:d::state');
    expect(JSON.parse(raw)).toEqual({ x: 'flushed' });
  });

  it('cancel drops a pending save without writing', async () => {
    const storage = makeMockAsyncStorage();
    const persist = new AsyncStoragePersist({
      dbName: 'd', asyncStorage: storage, saveDelayMs: 50,
    });
    persist.scheduleSave(new Map([['c', 'never']]));
    persist.cancel();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    expect(storage._store.size).toBe(0);
  });

  it('close is a no-op (surface parity with IndexedDBPersist)', () => {
    const storage = makeMockAsyncStorage();
    const persist = new AsyncStoragePersist({ dbName: 'd', asyncStorage: storage });
    expect(() => persist.close()).not.toThrow();
  });
});

describe('AsyncStoragePersist — namespace isolation', () => {
  it('different dbName values do not collide', async () => {
    const storage = makeMockAsyncStorage();
    const p1 = new AsyncStoragePersist({ dbName: 'cache-1', asyncStorage: storage });
    const p2 = new AsyncStoragePersist({ dbName: 'cache-2', asyncStorage: storage });
    await p1.save(new Map([['k', 'one']]));
    await p2.save(new Map([['k', 'two']]));
    const m1 = await p1.load();
    const m2 = await p2.load();
    expect(m1.get('k')).toBe('one');
    expect(m2.get('k')).toBe('two');
  });

  it('custom prefix isolates from default prefix', async () => {
    const storage = makeMockAsyncStorage();
    const p1 = new AsyncStoragePersist({ dbName: 'x', asyncStorage: storage });
    const p2 = new AsyncStoragePersist({ dbName: 'x', prefix: 'foo-cache:', asyncStorage: storage });
    await p1.save(new Map([['k', 'one']]));
    await p2.save(new Map([['k', 'two']]));
    expect(storage._store.size).toBe(2);
  });
});
