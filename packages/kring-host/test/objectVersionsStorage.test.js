/**
 * γ.2 — objectVersionsStorage: concrete versions adapter for circle stores,
 * consolidated onto the `@onderling/versioning` substrate (the retired
 * sync-engine `objectVersions.js` semantics must survive the swap):
 *   - Legacy list shape `{ts, sha256, value}` with the value INLINE.
 *   - Dedup: capturing a value identical to the newest entry is a no-op,
 *     with NO time window.
 *   - Per-circle retention cap (default 50, `retention.perKey` override).
 *   - Newest-first ordering.
 *   - Multiple stores / multiple circles don't collide.
 *   - capture/list defensively no-op on bad circleId or a broken backend.
 * New (consolidation win): `restore(circleId, ts)` returns the snapshot's
 * value (v1: caller persists it — the adapter never writes the live blob).
 */
import { describe, it, expect } from 'vitest';
import {
  createObjectVersionsAdapter,
  localStorageBackend,
  localStorageObjectVersions,
  fingerprintHex,
  versionsRootFor,
} from '../src/objectVersionsStorage.js';

/** Map-backed StorageBackend (get/put/delete/list) for adapter-level tests. */
function memBackend() {
  const m = new Map();
  return {
    map: m,
    get: async (k) => (m.has(k) ? { bytes: m.get(k) } : null),
    put: async (k, bytes) => { m.set(k, bytes); },
    delete: async (k) => { m.delete(k); },
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

/** Map-backed storage matching the DOM Storage shape (length/key incl.). */
function mockLocalStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe('createObjectVersionsAdapter', () => {
  it('captures + lists through the injected backend (legacy {ts, sha256, value} shape)', async () => {
    const backend = memBackend();
    const adapter = createObjectVersionsAdapter({ storeName: 'policy', backend });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    const list = await adapter.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 2 }, { v: 1 }]);
    for (const e of list) {
      expect(typeof e.ts).toBe('number');
      expect(typeof e.sha256).toBe('string');
      expect(e.sha256).toMatch(/^[0-9a-f]+$/);
    }
    // Per-version records under the v2 root.
    const keys = [...backend.map.keys()];
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(k.startsWith('cc.versions2.policy/c1/')).toBe(true);
  });

  it('dedups an identical value against the newest entry — no time window', async () => {
    let t = 1_000;
    const adapter = createObjectVersionsAdapter({
      storeName: 'policy',
      backend: memBackend(),
      now: () => t,
    });
    await adapter.capture('c1', { v: 1 });
    t += 1_000_000_000;                       // far beyond any debounce window
    await adapter.capture('c1', { v: 1 });    // identical → no-op
    expect(await adapter.list('c1')).toHaveLength(1);
    await adapter.capture('c1', { v: 2 });    // different → captured
    await adapter.capture('c1', { v: 1 });    // same as an OLDER entry → captured
    expect((await adapter.list('c1')).map((e) => e.value))
      .toEqual([{ v: 1 }, { v: 2 }, { v: 1 }]);
  });

  it('namespaces by storeName + circleId — different stores do not collide', async () => {
    const backend = memBackend();
    const policy = createObjectVersionsAdapter({ storeName: 'policy', backend });
    const recipe = createObjectVersionsAdapter({ storeName: 'recipe', backend });
    await policy.capture('c1', { kind: 'p' });
    await recipe.capture('c1', { kind: 'r' });
    const keys = [...backend.map.keys()].sort();
    expect(keys.some((k) => k.startsWith('cc.versions2.policy/c1/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('cc.versions2.recipe/c1/'))).toBe(true);
    expect((await policy.list('c1'))[0].value).toEqual({ kind: 'p' });
    expect((await recipe.list('c1'))[0].value).toEqual({ kind: 'r' });
  });

  it('different circleIds within the same store do not collide', async () => {
    const adapter = createObjectVersionsAdapter({ storeName: 'policy', backend: memBackend() });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c2', { v: 2 });
    expect((await adapter.list('c1'))[0].value).toEqual({ v: 1 });
    expect((await adapter.list('c2'))[0].value).toEqual({ v: 2 });
  });

  it('capture is a no-op for missing / non-string circleId', async () => {
    const backend = memBackend();
    const adapter = createObjectVersionsAdapter({ storeName: 'policy', backend });
    await adapter.capture('', { v: 1 });
    await adapter.capture(null, { v: 1 });
    expect(backend.map.size).toBe(0);
    expect(await adapter.list('')).toEqual([]);
  });

  it('list tolerates a throwing backend and returns []', async () => {
    const adapter = createObjectVersionsAdapter({
      storeName: 'policy',
      backend: {
        get: async () => { throw new Error('disk gone'); },
        put: async () => { throw new Error('disk gone'); },
        delete: async () => {},
        list: async () => { throw new Error('disk gone'); },
      },
    });
    expect(await adapter.list('c1')).toEqual([]);
    await adapter.capture('c1', { v: 1 });        // must not throw either
    expect(await adapter.restore('c1', 1)).toBeNull();
  });

  it('throws on missing storeName / backend', () => {
    expect(() => createObjectVersionsAdapter({})).toThrow(/storeName/);
    expect(() => createObjectVersionsAdapter({ storeName: 'x' })).toThrow(/backend/);
    expect(() => createObjectVersionsAdapter({ storeName: 'x', backend: {} })).toThrow(/backend/);
  });

  it('honours a custom retention.perKey (oldest evicted beyond the cap)', async () => {
    const adapter = createObjectVersionsAdapter({
      storeName: 'policy',
      backend: memBackend(),
      retention: { perKey: 2 },
    });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    await adapter.capture('c1', { v: 3 });
    const list = await adapter.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 3 }, { v: 2 }]);
  });

  it('restore returns the snapshot value at ts (and null for an unknown ts)', async () => {
    const adapter = createObjectVersionsAdapter({ storeName: 'policy', backend: memBackend() });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    const list = await adapter.list('c1');            // newest-first
    const oldest = list[list.length - 1];
    expect(await adapter.restore('c1', oldest.ts)).toEqual({ v: 1 });
    expect(await adapter.restore('c1', 424242)).toBeNull();
    expect(await adapter.restore('', oldest.ts)).toBeNull();
    // v1 semantics: restore reads history only — it never writes.
    expect(await adapter.list('c1')).toHaveLength(2);
  });
});

describe('fingerprintHex', () => {
  it('is deterministic, hex, and content-sensitive', () => {
    const a = fingerprintHex(JSON.stringify({ v: 1 }));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintHex(JSON.stringify({ v: 1 }))).toBe(a);
    expect(fingerprintHex(JSON.stringify({ v: 2 }))).not.toBe(a);
  });
});

describe('localStorageBackend', () => {
  it('round-trips records through a Storage-like backend', async () => {
    const storage = mockLocalStorage();
    const backend = localStorageBackend(storage);
    await backend.put('cc.versions2.policy/c1/1', { ts: 1, sha256: 'x', size: 1, content: '1' });
    expect((await backend.get('cc.versions2.policy/c1/1')).bytes)
      .toEqual({ ts: 1, sha256: 'x', size: 1, content: '1' });
    expect(await backend.list('cc.versions2.policy/c1/')).toEqual(['cc.versions2.policy/c1/1']);
    await backend.delete('cc.versions2.policy/c1/1');
    expect(await backend.get('cc.versions2.policy/c1/1')).toBeNull();
  });

  it('a corrupt record reads as absent (null)', async () => {
    const storage = mockLocalStorage();
    storage.map.set('cc.versions2.policy/c1/1', 'not json{');
    expect(await localStorageBackend(storage).get('cc.versions2.policy/c1/1')).toBeNull();
  });

  it('put tolerates a throwing storage (quota / disabled)', async () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
      key: () => null,
      length: 0,
    };
    await expect(
      localStorageBackend(storage).put('k', { ts: 1 })
    ).resolves.toBeUndefined();
  });

  it('tolerates an absent storage entirely (SSR)', async () => {
    const backend = localStorageBackend(undefined);
    expect(await backend.get('k')).toBeNull();
    expect(await backend.list('')).toEqual([]);
    await expect(backend.put('k', {})).resolves.toBeUndefined();
  });
});

describe('localStorageObjectVersions × circle scenario', () => {
  it('a fresh adapter over the same storage sees the prior history', async () => {
    const storage = mockLocalStorage();
    const a = localStorageObjectVersions('policy', storage);
    await a.capture('c1', { v: 1 });
    await a.capture('c1', { v: 2 });

    // Simulate a fresh app launch.
    const b = localStorageObjectVersions('policy', storage);
    const list = await b.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 2 }, { v: 1 }]);
  });

  it('ignores legacy cc.versions.* slot keys and corrupt records (no throw)', async () => {
    const storage = mockLocalStorage();
    // Legacy layout residue + a corrupt v2 record.
    storage.map.set('cc.versions.policy.c1', JSON.stringify([{ ts: 1, sha256: 'aa', value: { old: true } }]));
    storage.map.set(`${versionsRootFor('policy')}c1/5`, 'garbage');
    const a = localStorageObjectVersions('policy', storage);
    expect(await a.list('c1')).toEqual([]);
    await a.capture('c1', { v: 1 });
    const list = await a.list('c1');
    expect(list).toHaveLength(1);
    expect(list[0].value).toEqual({ v: 1 });
  });
});
