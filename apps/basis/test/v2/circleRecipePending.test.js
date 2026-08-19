/**
 * basis v2 — γ-next.recipe pending-recipe store factory tests.
 *
 * Verifies the tiny adapter shape (`get` / `set` / `clear`) forwards
 * to the injected IO, ignores empty circleIds, and swallows errors.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCircleRecipePendingStore } from '../../src/v2/circleRecipePending.js';

function fakeIo() {
  const calls = [];
  const cache = new Map();
  return {
    calls,
    cache,
    load: vi.fn(async (id) => { calls.push(['load', id]); return cache.get(id) ?? null; }),
    save: vi.fn(async (id, r) => { calls.push(['save', id, r]); cache.set(id, r); }),
    remove: vi.fn(async (id) => { calls.push(['remove', id]); cache.delete(id); }),
  };
}

describe('createCircleRecipePendingStore', () => {
  it('round-trips a recipe through load / save / remove', async () => {
    const io = fakeIo();
    const store = createCircleRecipePendingStore(io);

    await store.set('g1', { id: 'r1', name: 'Circle' });
    expect(io.save).toHaveBeenCalledWith('g1', { id: 'r1', name: 'Circle' });

    const r = await store.get('g1');
    expect(r).toEqual({ id: 'r1', name: 'Circle' });

    await store.clear('g1');
    expect(io.remove).toHaveBeenCalledWith('g1');
    expect(await store.get('g1')).toBeNull();
  });

  it('returns null when load is absent or no entry', async () => {
    const store = createCircleRecipePendingStore(fakeIo());
    expect(await store.get('missing')).toBeNull();
    const noIo = createCircleRecipePendingStore();
    expect(await noIo.get('g')).toBeNull();
  });

  it('ignores empty / non-string circleIds for set + clear (no-op, no IO)', async () => {
    const io = fakeIo();
    const store = createCircleRecipePendingStore(io);
    await store.set('', { id: 'r' });
    await store.set(null, { id: 'r' });
    await store.clear('');
    await store.clear(undefined);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.remove).not.toHaveBeenCalled();
  });

  it('swallows load errors and returns null', async () => {
    const store = createCircleRecipePendingStore({
      load: () => Promise.reject(new Error('IO down')),
    });
    expect(await store.get('g')).toBeNull();
  });

  it('swallows save errors (best-effort cache)', async () => {
    const store = createCircleRecipePendingStore({
      save: () => Promise.reject(new Error('quota')),
    });
    await expect(store.set('g', { id: 'r' })).resolves.toBeUndefined();
  });

  it('swallows remove errors', async () => {
    const store = createCircleRecipePendingStore({
      remove: () => Promise.reject(new Error('eperm')),
    });
    await expect(store.clear('g')).resolves.toBeUndefined();
  });
});
