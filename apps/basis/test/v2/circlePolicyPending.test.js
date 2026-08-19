/**
 * basis v2 — γ-next.policy pending-policy store factory tests.
 *
 * Verifies the tiny adapter shape (`get` / `set` / `clear`) forwards
 * to the injected IO, ignores empty circleIds, and swallows errors.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCirclePolicyPendingStore } from '../../src/v2/circlePolicyPending.js';

function fakeIo() {
  const calls = [];
  const cache = new Map();
  return {
    calls,
    cache,
    load: vi.fn(async (id) => { calls.push(['load', id]); return cache.get(id) ?? null; }),
    save: vi.fn(async (id, p) => { calls.push(['save', id, p]); cache.set(id, p); }),
    remove: vi.fn(async (id) => { calls.push(['remove', id]); cache.delete(id); }),
  };
}

describe('createCirclePolicyPendingStore', () => {
  it('round-trips a policy doc through load / save / remove', async () => {
    const io = fakeIo();
    const store = createCirclePolicyPendingStore(io);

    await store.set('g1', { view: 'screen' });
    expect(io.save).toHaveBeenCalledWith('g1', { view: 'screen' });

    const p = await store.get('g1');
    expect(p).toEqual({ view: 'screen' });

    await store.clear('g1');
    expect(io.remove).toHaveBeenCalledWith('g1');
    expect(await store.get('g1')).toBeNull();
  });

  it('returns null when load is absent or no entry', async () => {
    const store = createCirclePolicyPendingStore(fakeIo());
    expect(await store.get('missing')).toBeNull();
    const noIo = createCirclePolicyPendingStore();
    expect(await noIo.get('g')).toBeNull();
  });

  it('ignores empty / non-string circleIds for set + clear (no-op, no IO)', async () => {
    const io = fakeIo();
    const store = createCirclePolicyPendingStore(io);
    await store.set('', { view: 'screen' });
    await store.set(null, { view: 'screen' });
    await store.clear('');
    await store.clear(undefined);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.remove).not.toHaveBeenCalled();
  });

  it('swallows load errors and returns null', async () => {
    const store = createCirclePolicyPendingStore({
      load: () => Promise.reject(new Error('IO down')),
    });
    expect(await store.get('g')).toBeNull();
  });

  it('swallows save errors (best-effort cache)', async () => {
    const store = createCirclePolicyPendingStore({
      save: () => Promise.reject(new Error('quota')),
    });
    await expect(store.set('g', { view: 'screen' })).resolves.toBeUndefined();
  });

  it('swallows remove errors', async () => {
    const store = createCirclePolicyPendingStore({
      remove: () => Promise.reject(new Error('eperm')),
    });
    await expect(store.clear('g')).resolves.toBeUndefined();
  });
});
