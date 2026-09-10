// γ.2 (2026-06-01; consolidated onto @onderling/versioning 2026-07-09) —
// AsyncStorage-backed versions adapter round-trip.
//
// Mirrors `packages/kring-host/test/objectVersionsStorage.test.js`:
// proves the AsyncStorage adapter produces the same LOGICAL key shape
// (`cc.versions2.<storeName>/<circleId>/<ts>`, physically under the
// `ccv:` AsyncStorage scope) and the same legacy `{ts, sha256, value}`
// list shape, so a future pod-sync sees one shape on both surfaces.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  asyncStorageObjectVersions,
  VERSIONS_AS_SCOPE,
} from '../src/core/objectVersionsStorageRN.js';
import { useTestContentSeal } from './support/contentSeal.js';

// A real device holds a content key before any circle store exists; these tests build one without an
// agent, so they announce the key the same way boot does. Without it every local write refuses, by design.
useTestContentSeal();

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
    async getAllKeys()  { return [...m.keys()]; },
  };
}

const scoped = (k) => `${VERSIONS_AS_SCOPE}:${k}`;

describe('γ.2 — objectVersionsStorageRN (@onderling/versioning substrate)', () => {
  let storage;
  beforeEach(() => { storage = mockAsyncStorage(); });

  it('round-trips one record per version under ccv:cc.versions2.<storeName>/<circleId>/', async () => {
    const adapter = asyncStorageObjectVersions('policy', storage);
    await adapter.capture('c1', { features: { tasks: true } });
    const keys = [...storage.map.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(scoped('cc.versions2.policy/c1/'))).toBe(true);
    const list = await adapter.list('c1');
    expect(list).toHaveLength(1);
    expect(list[0].value).toEqual({ features: { tasks: true } });
    expect(typeof list[0].ts).toBe('number');
    expect(list[0].sha256).toMatch(/^[0-9a-f]+$/);
  });

  it('mobile + web logical key shape is identical (cc.versions2.<storeName>/<id>/<ts>)', async () => {
    const adapter = asyncStorageObjectVersions('recipe', storage);
    await adapter.capture('circle-42', { recipes: [], activeId: null });
    const keys = [...storage.map.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ccv:cc\.versions2\.recipe\/circle-42\/\d+$/);
  });

  it('list spans capture sessions (a fresh adapter sees prior history)', async () => {
    const a = asyncStorageObjectVersions('rules', storage);
    await a.capture('c1', { purpose: 'A' });
    await a.capture('c1', { purpose: 'B' });

    const b = asyncStorageObjectVersions('rules', storage);
    const list = await b.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ purpose: 'B' }, { purpose: 'A' }]);
  });

  it('dedups an identical value against the newest entry', async () => {
    const a = asyncStorageObjectVersions('rules', storage);
    await a.capture('c1', { purpose: 'A' });
    await a.capture('c1', { purpose: 'A' });
    expect(await a.list('c1')).toHaveLength(1);
  });

  it('honours custom retention.perKey', async () => {
    const adapter = asyncStorageObjectVersions('policy', storage, { perKey: 2 });
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    await adapter.capture('c1', { v: 3 });
    const list = await adapter.list('c1');
    expect(list.map((e) => e.value)).toEqual([{ v: 3 }, { v: 2 }]);
  });

  it('restore returns the snapshot value for a listed ts (never writes)', async () => {
    const adapter = asyncStorageObjectVersions('policy', storage);
    await adapter.capture('c1', { v: 1 });
    await adapter.capture('c1', { v: 2 });
    const list = await adapter.list('c1');
    expect(await adapter.restore('c1', list[list.length - 1].ts)).toEqual({ v: 1 });
    expect(await adapter.list('c1')).toHaveLength(2);
  });

  it('a corrupt stored record reads as an empty history slot (no throw)', async () => {
    storage.map.set(scoped('cc.versions2.policy/bad/5'), '{not json');
    const adapter = asyncStorageObjectVersions('policy', storage);
    expect(await adapter.list('bad')).toEqual([]);
  });
});
