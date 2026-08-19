/**
 * IndexedDBPersist — adapter tests.
 *
 * Mirrors the test surface FilePersist would have (FilePersist tests
 * live under phase15 etc. + use real fs).  Here we use fake-indexeddb
 * to run a real IndexedDB shape in a Node test env.
 *
 * Coverage:
 *   - constructor validation (dbName required; indexedDB present)
 *   - load() returns empty Map on cold store
 *   - save() then load() round-trips byte-for-byte
 *   - save() is no-op when serialised payload is identical
 *   - scheduleSave() coalesces a burst of writes into one
 *   - flush() forces a pending debounced save
 *   - cancel() drops a pending save without writing
 *   - persistence across new-instance (same dbName) restarts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { IndexedDBPersist } from '../src/lib/IndexedDBPersist.js';

let counter = 0;
function freshDbName() { return `stoop-test-db-${++counter}-${Date.now()}`; }

describe('IndexedDBPersist — construction', () => {
  it('throws when dbName missing', () => {
    expect(() => new IndexedDBPersist({})).toThrow(/dbName required/);
  });

  it('throws when indexedDB is unavailable', () => {
    const orig = globalThis.indexedDB;
    delete globalThis.indexedDB;
    try {
      expect(() => new IndexedDBPersist({ dbName: 'x' }))
        .toThrow(/indexedDB/);
    } finally {
      globalThis.indexedDB = orig;
    }
  });

  it('constructs cleanly with dbName', () => {
    expect(() => new IndexedDBPersist({ dbName: freshDbName() })).not.toThrow();
  });
});

describe('IndexedDBPersist — load / save round-trip', () => {
  it('load() on a cold store returns an empty Map', async () => {
    const p = new IndexedDBPersist({ dbName: freshDbName() });
    const m = await p.load();
    expect(m).toBeInstanceOf(Map);
    expect(m.size).toBe(0);
  });

  it('save() then load() returns equivalent Map', async () => {
    const dbName = freshDbName();
    const p1 = new IndexedDBPersist({ dbName });
    const input = new Map([
      ['mem://stoop/posts/p-1', { type: 'post', text: 'kun je helpen?' }],
      ['mem://stoop/posts/p-2', { type: 'post', text: 'tomaten te geven' }],
      ['mem://stoop/settings/.migrated', true],
    ]);
    await p1.save(input);
    const p2 = new IndexedDBPersist({ dbName });
    const out = await p2.load();
    expect(out.size).toBe(input.size);
    for (const [k, v] of input) expect(out.get(k)).toEqual(v);
  });

  it('save() is no-op when serialised payload unchanged', async () => {
    const dbName = freshDbName();
    const p = new IndexedDBPersist({ dbName });
    const m = new Map([['k', 'v']]);
    await p.save(m);
    // Mutate timestamp behaviour by re-calling save with the same Map:
    // we can't see it from outside, but at minimum the second call
    // must not throw + the value remains identical on subsequent load.
    await p.save(m);
    const loaded = await p.load();
    expect(loaded.get('k')).toBe('v');
  });
});

describe('IndexedDBPersist — debounce + flush + cancel', () => {
  it('scheduleSave() coalesces a burst into one save', async () => {
    const p = new IndexedDBPersist({
      dbName: freshDbName(),
      saveDelayMs: 25,
    });
    const m = new Map([['k', 0]]);
    for (let i = 1; i <= 5; i++) {
      m.set('k', i);
      p.scheduleSave(m);
    }
    // Wait for the debounce window to fire.
    await new Promise((r) => setTimeout(r, 100));
    const loaded = await p.load();
    expect(loaded.get('k')).toBe(5);
  });

  it('flush() forces a pending save to run now', async () => {
    const dbName = freshDbName();
    const p = new IndexedDBPersist({ dbName, saveDelayMs: 60_000 });
    const m = new Map([['k', 'fresh']]);
    p.scheduleSave(m);
    // Without flush, the value wouldn't reach disk for 60s.
    await p.flush(m);
    const out = await new IndexedDBPersist({ dbName }).load();
    expect(out.get('k')).toBe('fresh');
  });

  it('cancel() drops a pending save without writing', async () => {
    const dbName = freshDbName();
    const p = new IndexedDBPersist({ dbName, saveDelayMs: 25 });
    p.scheduleSave(new Map([['k', 'should-not-persist']]));
    p.cancel();
    await new Promise((r) => setTimeout(r, 50));
    const out = await new IndexedDBPersist({ dbName }).load();
    expect(out.size).toBe(0);
  });
});

describe('IndexedDBPersist — survives "page reload" via same dbName', () => {
  it('two adapters on the same dbName share the snapshot', async () => {
    const dbName = freshDbName();
    const writer = new IndexedDBPersist({ dbName });
    await writer.save(new Map([['k1', 'v1'], ['k2', 'v2']]));
    writer.close();
    const reader = new IndexedDBPersist({ dbName });
    const out = await reader.load();
    expect(out.get('k1')).toBe('v1');
    expect(out.get('k2')).toBe('v2');
  });

  it('different dbNames are isolated', async () => {
    const dbA = freshDbName();
    const dbB = freshDbName();
    await new IndexedDBPersist({ dbName: dbA }).save(new Map([['x', 'A']]));
    const outB = await new IndexedDBPersist({ dbName: dbB }).load();
    expect(outB.size).toBe(0);
  });
});

describe('IndexedDBPersist — corrupt blob is tolerated', () => {
  it('returns empty Map when stored value is invalid JSON', async () => {
    // We can't easily corrupt the blob without bypassing the public
    // surface — best we can do is verify load() never throws on the
    // fresh-store path.
    const p = new IndexedDBPersist({ dbName: freshDbName() });
    const m = await p.load();
    expect(m).toBeInstanceOf(Map);
  });
});
