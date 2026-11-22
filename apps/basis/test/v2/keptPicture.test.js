/**
 * A kept picture stays until the live state is CAUGHT UP, and only a caught-up live state is kept (the cold start on
 * the phone: Today's kept blocks were replaced by an early empty read, and the circles list had no picture at all).
 */
import { describe, it, expect, vi } from 'vitest';
import { keptPictureView, mayKeepPicture, keptCircleRow, createKeptCircles, KEPT_CIRCLES_KEY } from '../../src/v2/keptPicture.js';

describe('which picture is painted', () => {
  const kept = [{ id: 'k' }];
  it('a live read before the sources are caught up does NOT replace the kept picture, even an empty one', () => {
    expect(keptPictureView({ kept, live: [], caughtUp: false })).toEqual({ source: 'kept', value: kept, refreshing: true });
  });
  it('a caught-up live state replaces it, also when it is empty (an empty day is real)', () => {
    expect(keptPictureView({ kept, live: [], caughtUp: true })).toEqual({ source: 'live', value: [], refreshing: false });
  });
  it('caught up but not read yet: the kept picture, refreshing', () => {
    expect(keptPictureView({ kept, live: null, caughtUp: true }).source).toBe('kept');
  });
  it('no kept picture: the live value as it is, or nothing', () => {
    expect(keptPictureView({ kept: null, live: [1], caughtUp: false })).toEqual({ source: 'live', value: [1], refreshing: false });
    expect(keptPictureView({}).source).toBe('none');
  });
  it('only a caught-up live state may be kept', () => {
    expect(mayKeepPicture({ caughtUp: false })).toBe(false);
    expect(mayKeepPicture({})).toBe(false);
    expect(mayKeepPicture({ caughtUp: true })).toBe(true);
  });
});

describe('a kept circles row holds what a tile paints, nothing more', () => {
  it('id, name, member count, the preview line and the unread count', () => {
    const row = keptCircleRow({ id: 'c1', name: 'Huis', memberCount: 3, roster: ['x'], key: 'secret' }, { subtitle: 'An: hoi', unread: 2, raw: {} });
    expect(row).toEqual({ id: 'c1', name: 'Huis', memberCount: 3, subtitle: 'An: hoi', unread: 2 });
  });
  it('no id, no row', () => { expect(keptCircleRow({ name: 'x' })).toBe(null); });
});

describe('the kept circles store', () => {
  const memoryKv = () => { const m = new Map(); return { m, getItem: async (k) => m.get(k) ?? null, setItem: vi.fn(async (k, v) => { m.set(k, v); }) }; };
  it('an early list is never written; a caught-up one is, and reads back', async () => {
    const kv = memoryKv(); const kc = createKeptCircles(kv);
    await kc.keep([{ id: 'c1', name: 'A' }], { caughtUp: false });
    expect(kv.m.has(KEPT_CIRCLES_KEY)).toBe(false);
    await kc.keep([{ id: 'c1', name: 'A' }], { caughtUp: true });
    expect(await createKeptCircles(kv).read()).toEqual([{ id: 'c1', name: 'A' }]);
  });
  it('the same list is not written twice; changes within a second are written once, the newest', async () => {
    vi.useFakeTimers();
    try {
      let t = 0; const kv = memoryKv(); const kc = createKeptCircles(kv, { now: () => t });
      await kc.keep([{ id: 'a' }], { caughtUp: true });
      await kc.keep([{ id: 'a' }], { caughtUp: true });
      expect(kv.setItem).toHaveBeenCalledTimes(1);
      t = 100; await kc.keep([{ id: 'b' }], { caughtUp: true });
      t = 200; await kc.keep([{ id: 'c' }], { caughtUp: true });
      expect(kv.setItem).toHaveBeenCalledTimes(1);
      t = 1000; await vi.advanceTimersByTimeAsync(1000);
      expect(kv.setItem).toHaveBeenCalledTimes(2);
      expect(JSON.parse(kv.m.get(KEPT_CIRCLES_KEY))).toEqual([{ id: 'c' }]);
    } finally { vi.useRealTimers(); }
  });
  it('an unreadable value is no picture', async () => {
    const kv = memoryKv(); kv.m.set(KEPT_CIRCLES_KEY, 'not json');
    expect(await createKeptCircles(kv).read()).toBe(null);
  });
});

describe('forgetting a device leaves no kept circles list behind', () => {
  it('the kept list key is on the forget list', async () => {
    const { THROWAWAY_CONTENT } = await import('../../src/v2/enrolForgets.js');
    expect(THROWAWAY_CONTENT.keyPrefixes.some((p) => KEPT_CIRCLES_KEY.startsWith(p))).toBe(true);
  });
});
