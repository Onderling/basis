/**
 * A circle store holds what it read. On a phone, Vandaag's blocks listed every circle's store item by item on each
 * landing — five readers per circle, every record read, parsed and walked again — and that was most of a 2 s block of
 * JS per screen. The store now keeps its items in memory once read, and a read is served from there while nothing
 * beneath it has changed. "Nothing changed" is the data source's own `revision`: any write to the medium that the store
 * did not make itself (another circle's, a pod pull, a forget, a restore) drops what it holds, and the next read loads
 * once more. A source without a revision gets no memory at all.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { createCircleStores } from '../src/circleStores.js';

/** A data source that counts its reads and bumps a revision on every change, like the caching data source. */
function countingSource({ revision = true } = {}) {
  const m = new Map();
  const s = {
    reads: 0, lists: 0, rev: 0,
    async read(p) { s.reads += 1; return m.has(p) ? m.get(p) : null; },
    async write(p, d) { m.set(p, d); s.rev += 1; },
    async delete(p) { m.delete(p); s.rev += 1; },
    async list(prefix) { s.lists += 1; return [...m.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
  if (revision) Object.defineProperty(s, 'revision', { get: () => s.rev });
  return s;
}
const ROOT = 'mem://circles/c1/';

describe('a circle store holds what it read', () => {
  it('the second list reads nothing from the source; the first reads each item once', async () => {
    const src = countingSource();
    const store = new CircleItemStore({ dataSource: src, rootContainer: ROOT });
    for (let i = 0; i < 5; i++) await store.put({ type: 'task', text: `t${i}` });
    const fresh = new CircleItemStore({ dataSource: src, rootContainer: ROOT });   // a new instance: nothing held yet
    src.reads = 0; src.lists = 0;
    expect(await fresh.list()).toHaveLength(5);
    expect(src.reads).toBe(5);
    src.reads = 0; src.lists = 0;
    expect(await fresh.list()).toHaveLength(5);
    expect(await fresh.listByType('task')).toHaveLength(5);
    expect(src.reads + src.lists).toBe(0);
  });

  it('its own writes keep what it holds current, with no read', async () => {
    const src = countingSource();
    const store = new CircleItemStore({ dataSource: src, rootContainer: ROOT });
    const a = await store.put({ type: 'task', text: 'a' });
    await store.list();
    src.reads = 0; src.lists = 0;
    await store.put({ type: 'note', text: 'b' });
    await store.put({ ...a, text: 'a2' });
    await store.delete(a.id);
    const all = await store.list();
    expect(all.map((x) => x.text)).toEqual(['b']);
    expect(src.reads + src.lists).toBe(0);
  });

  it('a write beneath it (another writer on the same medium) is seen on the next read', async () => {
    const src = countingSource();
    const store = new CircleItemStore({ dataSource: src, rootContainer: ROOT });
    const a = await store.put({ type: 'task', text: 'a' });
    await store.list();
    await src.write(`${ROOT}items/${a.id}.json`, JSON.stringify({ ...a, text: 'changed beneath' }));
    await src.write(`${ROOT}items/x1.json`, JSON.stringify({ id: 'x1', type: 'task', text: 'added beneath' }));
    const texts = (await store.list()).map((x) => x.text).sort();
    expect(texts).toEqual(['added beneath', 'changed beneath']);
    expect((await store.get(a.id)).text).toBe('changed beneath');
  });

  it('what a caller does to a listed item never changes what the store holds', async () => {
    const src = countingSource();
    const store = new CircleItemStore({ dataSource: src, rootContainer: ROOT });
    await store.put({ type: 'task', text: 'a', tags: ['x'] });
    const [first] = await store.list();
    first.text = 'mutated'; first.tags.push('y');
    const [again] = await store.list();
    expect(again.text).toBe('a');
    expect(again.tags).toEqual(['x']);
  });

  it('listByType never walks the other types', async () => {
    const src = countingSource();
    const store = new CircleItemStore({ dataSource: src, rootContainer: ROOT });
    for (let i = 0; i < 3; i++) await store.put({ type: 'task', text: `t${i}` });
    for (let i = 0; i < 50; i++) await store.put({ type: 'note', text: `n${i}` });
    await store.list();
    const parsed = { n: 0 };
    const orig = JSON.parse;
    JSON.parse = function (...a) { parsed.n += 1; return orig.apply(this, a); };
    try { expect(await store.listByType('task')).toHaveLength(3); } finally { JSON.parse = orig; }
    expect(parsed.n).toBe(3);
  });

  it('a source with no revision gets no memory: every list reads the source', async () => {
    const src = countingSource({ revision: false });
    const store = new CircleItemStore({ dataSource: src, rootContainer: ROOT });
    await store.put({ type: 'task', text: 'a' });
    await store.list();
    src.reads = 0;
    await store.list();
    expect(src.reads).toBe(1);
  });

  it('a circle forgotten beneath its store (createCircleStores.forget) reads empty from a store still held', async () => {
    const src = countingSource();
    const stores = createCircleStores({ dataSource: src });
    const held = stores.getStore('c1');
    await held.put({ type: 'task', text: 'a' });
    await held.put({ type: 'task', text: 'b' });
    expect(await held.list()).toHaveLength(2);
    expect(await stores.forget('c1')).toBe(2);
    expect(await held.list()).toEqual([]);
    expect(await held.listByType('task')).toEqual([]);
  });
});

