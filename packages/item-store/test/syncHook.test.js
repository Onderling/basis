/**
 * CircleItemStore sync hook + wireStoreMirror (cluster L3 · no-pod-sync-off-household).
 * The publish-on-write seam that lets a peer mirror fan-out writes from the per-circle store — independent of
 * the household agent. Best-effort + non-blocking; the keystone for migrating no-pod sync off household.
 */
import { describe, it, expect, vi } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { wireStoreMirror } from '../src/mirrorSync.js';
import { createCircleStores } from '../src/circleStores.js';

const mk = () => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c/' });

describe('CircleItemStore — setSyncHook (publish-on-write)', () => {
  it('fires publishItem on put + publishItemRemoved on delete', async () => {
    const store = mk();
    const publishItem = vi.fn(), publishItemRemoved = vi.fn();
    store.setSyncHook({ publishItem, publishItemRemoved });
    const item = await store.put({ type: 'task', text: 'x' });
    expect(publishItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, type: 'task', text: 'x' }));
    await store.delete(item.id);
    // The removal hands the removed ITEM alongside the id, so a routing publisher can pick a path by type.
    expect(publishItemRemoved).toHaveBeenCalledWith(item.id, expect.objectContaining({ id: item.id, type: 'task' }));
  });

  it('no hook → writes succeed (no-op)', async () => {
    const store = mk();
    const item = await store.put({ type: 'task', text: 'x' });
    expect((await store.get(item.id)).text).toBe('x');
  });

  it('a throwing / rejecting hook never fails the write (best-effort, non-blocking)', async () => {
    const store = mk();
    store.setSyncHook({
      publishItem:        () => { throw new Error('boom'); },
      publishItemRemoved: () => Promise.reject(new Error('boom')),
    });
    const item = await store.put({ type: 'task', text: 'survives' });   // does not throw
    expect((await store.get(item.id)).text).toBe('survives');
    await expect(store.delete(item.id)).resolves.toBeUndefined();        // does not throw
  });

  it('setSyncHook(null) detaches', async () => {
    const store = mk();
    const publishItem = vi.fn();
    store.setSyncHook({ publishItem });
    store.setSyncHook(null);
    await store.put({ type: 'task', text: 'x' });
    expect(publishItem).not.toHaveBeenCalled();
  });
});

describe('wireStoreMirror', () => {
  it('routes writes/deletes to a mirror; the returned detach stops it', async () => {
    const store = mk();
    const mirror = { publishItem: vi.fn(), publishItemRemoved: vi.fn() };
    const detach = wireStoreMirror(store, mirror);
    const a = await store.put({ type: 'task', text: 'milk' });
    expect(mirror.publishItem).toHaveBeenCalledWith(expect.objectContaining({ id: a.id, text: 'milk' }));
    await store.delete(a.id);
    expect(mirror.publishItemRemoved).toHaveBeenCalledWith(a.id, expect.objectContaining({ id: a.id }));

    detach();
    await store.put({ type: 'task', text: 'after-detach' });
    expect(mirror.publishItem).toHaveBeenCalledTimes(1);   // no further fan-out
  });

  it('tolerates a partial mirror (only publishItem)', async () => {
    const store = mk();
    const mirror = { publishItem: vi.fn() };               // no publishItemRemoved
    wireStoreMirror(store, mirror);
    const a = await store.put({ type: 'task', text: 'x' });
    await expect(store.delete(a.id)).resolves.toBeUndefined();   // no throw despite missing publishItemRemoved
    expect(mirror.publishItem).toHaveBeenCalled();
  });
});

describe('createCircleStores — onStore mirror-attach seam', () => {
  it('calls onStore ONCE per circle, on first store creation', () => {
    const onStore = vi.fn();
    const stores = createCircleStores({ dataSource: memoryDataSource(), onStore });
    const s1 = stores.getStore('c1');
    stores.getStore('c1');   // cached → no second call
    stores.getStore('c2');
    expect(onStore).toHaveBeenCalledTimes(2);
    expect(onStore).toHaveBeenCalledWith('c1', s1);
  });

  it('onStore wires a per-circle mirror end-to-end (publish-on-write)', async () => {
    const mirror = { publishItem: vi.fn(), publishItemRemoved: vi.fn() };
    const stores = createCircleStores({
      dataSource: memoryDataSource(),
      onStore: (_id, s) => wireStoreMirror(s, mirror),     // the L3 realAgent wiring shape
    });
    const item = await stores.getStore('c1').put({ type: 'task', text: 'hi' });
    expect(mirror.publishItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, text: 'hi' }));
  });
});
