/**
 * createCircleStores + memoryDataSource (cluster L · L1 integration).
 * Proves the per-circle registry: one store per circle, cached, isolated by rootContainer over ONE shared
 * DataSource, registry-validated — the substrate L2/L3/L4 consume.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores } from '../src/circleStores.js';
import { memoryDataSource } from '../src/memoryDataSource.js';

const registry = {
  validate: (it) => (['task', 'note', 'list'].includes(it.type)
    ? { ok: true }
    : { ok: false, errors: [{ message: `unknown type: "${it.type}"` }] }),
};

describe('createCircleStores (L1 integration)', () => {
  it('caches one store per circleId', () => {
    const f = createCircleStores({ dataSource: memoryDataSource(), registry });
    const a1 = f.getStore('c1');
    const a2 = f.getStore('c1');
    expect(a1).toBe(a2);                       // same instance, cached
    expect(f.getStore('c2')).not.toBe(a1);     // different circle → different store
    expect(f.has('c1')).toBe(true);
    expect(f.has('cX')).toBe(false);
  });

  it('isolates circles over ONE shared DataSource (rootContainer namespacing)', async () => {
    const ds = memoryDataSource();
    const f = createCircleStores({ dataSource: ds, registry });
    await f.getStore('A').put({ type: 'task', text: 'in A' });
    await f.getStore('B').put({ type: 'task', text: 'in B' });
    expect((await f.getStore('A').list()).map((i) => i.text)).toEqual(['in A']);
    expect((await f.getStore('B').list()).map((i) => i.text)).toEqual(['in B']);
    // one backing store, namespaced by circle
    expect(ds._map.size).toBe(2);
    expect([...ds._map.keys()].some((k) => k.includes('/circles/A/'))).toBe(true);
    expect([...ds._map.keys()].some((k) => k.includes('/circles/B/'))).toBe(true);
  });

  it('validates via the injected registry, shared across circles', async () => {
    const f = createCircleStores({ dataSource: memoryDataSource(), registry });
    await expect(f.getStore('c').put({ type: 'bogus' })).rejects.toThrow(/invalid "bogus"/);
    const ok = await f.getStore('c').put({ type: 'note', text: 'fine' });
    expect(ok.type).toBe('note');
  });

  it('rootFor + construction/argument guards', () => {
    const f = createCircleStores({ dataSource: memoryDataSource() });
    expect(f.rootFor('c1')).toBe('mem://circles/c1/');
    expect(() => createCircleStores({})).toThrow(/dataSource/i);
    expect(() => f.getStore('')).toThrow(/circleId/);
  });

  it('dataSourceFor routes a pod-backed circle to its OWN medium; others use the shared backing', async () => {
    const shared = memoryDataSource();
    const podMedium = memoryDataSource();                 // stands in for a cache-mode PseudoPod medium
    const f = createCircleStores({
      dataSource: shared,
      registry,
      dataSourceFor: (circleId) => (circleId === 'pod-circle' ? podMedium : null),   // null → shared (back-compat)
    });

    await f.getStore('pod-circle').put({ type: 'task', text: 'on the pod' });
    await f.getStore('local-circle').put({ type: 'task', text: 'local only' });

    // The pod-backed circle's item landed in ITS medium, not the shared one …
    expect((await podMedium.list('mem://circles/pod-circle/')).length).toBeGreaterThan(0);
    expect(await shared.list('mem://circles/pod-circle/')).toEqual([]);
    // … and the ordinary circle's item landed in the shared backing (unchanged behaviour).
    expect((await shared.list('mem://circles/local-circle/')).length).toBeGreaterThan(0);
    expect(await podMedium.list('mem://circles/local-circle/')).toEqual([]);
  });
});

describe('memoryDataSource', () => {
  it('read/write/delete/list with prefix filtering', async () => {
    const ds = memoryDataSource();
    await ds.write('mem://a/1', 'x');
    await ds.write('mem://a/2', 'y');
    await ds.write('mem://b/1', 'z');
    expect(await ds.read('mem://a/1')).toBe('x');
    expect(await ds.read('mem://missing')).toBeNull();
    expect((await ds.list('mem://a/')).sort()).toEqual(['mem://a/1', 'mem://a/2']);
    await ds.delete('mem://a/1');
    expect(await ds.read('mem://a/1')).toBeNull();
    expect(await ds.list('mem://a/')).toEqual(['mem://a/2']);
  });
});
