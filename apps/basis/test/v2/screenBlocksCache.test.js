/**
 * basis v2 — δ.1 screen-blocks cache factory tests.
 *
 * Verifies the tiny adapter shape (`get` / `set` / `clear`) forwards to
 * the injected IO, ignores empty screenIds, and swallows errors.
 */
import { describe, it, expect, vi } from 'vitest';
import { createScreenBlocksCache } from '../../src/v2/screenBlocksCache.js';

function fakeIo() {
  const calls = [];
  const cache = new Map();
  return {
    calls,
    cache,
    load: vi.fn(async (id) => { calls.push(['load', id]); return cache.get(id) ?? null; }),
    save: vi.fn(async (id, b) => { calls.push(['save', id, b]); cache.set(id, b); }),
    remove: vi.fn(async (id) => { calls.push(['remove', id]); cache.delete(id); }),
  };
}

describe('createScreenBlocksCache', () => {
  it('round-trips blocks through load / save / remove', async () => {
    const io = fakeIo();
    const store = createScreenBlocksCache(io);

    const blocks = [{ blockId: 'b1', type: 'noticeboard', status: 'ok' }];
    await store.set('s1', blocks);
    expect(io.save).toHaveBeenCalledWith('s1', blocks);

    const r = await store.get('s1');
    expect(r).toEqual(blocks);

    await store.clear('s1');
    expect(io.remove).toHaveBeenCalledWith('s1');
    expect(await store.get('s1')).toBeNull();
  });

  it('returns null when load is absent or no entry', async () => {
    const store = createScreenBlocksCache(fakeIo());
    expect(await store.get('missing')).toBeNull();
    const noIo = createScreenBlocksCache();
    expect(await noIo.get('s')).toBeNull();
  });

  it('ignores empty / non-string screenIds for set + clear (no-op, no IO)', async () => {
    const io = fakeIo();
    const store = createScreenBlocksCache(io);
    await store.set('', [{ blockId: 'b' }]);
    await store.set(null, [{ blockId: 'b' }]);
    await store.clear('');
    await store.clear(undefined);
    expect(io.save).not.toHaveBeenCalled();
    expect(io.remove).not.toHaveBeenCalled();
  });

  it('returns null when load throws', async () => {
    const store = createScreenBlocksCache({
      load: () => Promise.reject(new Error('IO down')),
    });
    expect(await store.get('s')).toBeNull();
  });

  it('swallows save errors (best-effort cache)', async () => {
    const store = createScreenBlocksCache({
      save: () => Promise.reject(new Error('quota')),
    });
    await expect(store.set('s', [{ blockId: 'b' }])).resolves.toBeUndefined();
  });

  it('swallows remove errors', async () => {
    const store = createScreenBlocksCache({
      remove: () => Promise.reject(new Error('eperm')),
    });
    await expect(store.clear('s')).resolves.toBeUndefined();
  });

  it('stores arbitrary JSON blob shapes (array of mixed blocks)', async () => {
    const io = fakeIo();
    const store = createScreenBlocksCache(io);
    const blocks = [
      { blockId: 'b1', type: 'announcement', status: 'ok', content: { text: 'Hi' } },
      { blockId: 'b2', type: 'tasks', status: 'ok', content: { items: [{ id: 't1', text: 'A' }] } },
      { blockId: 'b3', type: 'calendar', status: 'empty', content: {} },
    ];
    await store.set('s2', blocks);
    expect(await store.get('s2')).toEqual(blocks);
  });
});
