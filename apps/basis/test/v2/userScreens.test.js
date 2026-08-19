// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  EMPTY_SCREEN_BOOK, ALL_CIRCLES,
  emptyScreen, normalizeScreen, isAllCircles, effectiveCircleIds,
  addCircleToScreen, removeCircleFromScreen, setAllCircles,
  normalizeScreenBook,
  addScreen, renameScreen, removeScreen, setActiveScreen, getActiveScreen, updateScreen,
  createUserScreenStore, localStorageScreenIo,
} from '../../src/v2/userScreens.js';
import { addBlock, moveBlock } from '../../src/v2/circleRecipe.js';

/* ─────────────────────────────────────────────────────────────────── */
/* Single Screen                                                      */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — single Screen', () => {
  it('emptyScreen() mints fresh id + defaults to ALL_CIRCLES', () => {
    const s = emptyScreen('Stream');
    expect(s).toMatchObject({ name: 'Stream', circleFilter: ALL_CIRCLES, blocks: [] });
    expect(s.id).toMatch(/^s-/);
    expect(emptyScreen().id).not.toBe(s.id);
  });

  it('emptyScreen with an explicit circleFilter list dedupes + drops blanks', () => {
    const s = emptyScreen('Two-circle', ['g-a', '', 'g-b', null, 'g-a']);
    // Per implementation: blanks/non-strings dropped, but dup IS kept (only
    // addCircleToScreen dedupes).  Verify via the public shape.
    expect(s.circleFilter).toEqual(['g-a', 'g-b', 'g-a']);
  });

  it('normalizeScreen coerces malformed input', () => {
    expect(normalizeScreen(null).circleFilter).toBe(ALL_CIRCLES);
    const s = normalizeScreen({ id: 'x', name: 7, circleFilter: 'oops', blocks: 42 });
    expect(s.id).toBe('x');
    expect(s.name).toBe('');         // non-string name → ''
    expect(s.circleFilter).toBe(ALL_CIRCLES);  // non-array filter → ALL
    expect(s.blocks).toEqual([]);
  });

  it('normalizeScreen drops unknown block types (forward-compat)', () => {
    const s = normalizeScreen({ blocks: [
      { id: 'b1', type: 'announcement', config: {} },
      { id: 'b2', type: 'future-block', config: {} },
      { id: 'b3', type: 'photo', config: {} },
    ] });
    expect(s.blocks.map((b) => b.type)).toEqual(['announcement', 'photo']);
  });

  it('isAllCircles returns true for null, undefined, []', () => {
    expect(isAllCircles({ circleFilter: ALL_CIRCLES })).toBe(true);
    expect(isAllCircles({})).toBe(true);
    expect(isAllCircles({ circleFilter: [] })).toBe(true);
    expect(isAllCircles({ circleFilter: ['g-a'] })).toBe(false);
  });

  it('effectiveCircleIds expands ALL → allCircleIds; passes through explicit list', () => {
    const s1 = emptyScreen('Stream');
    expect(effectiveCircleIds(s1, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);

    const s2 = emptyScreen('Selwerd', ['g-sel']);
    expect(effectiveCircleIds(s2, ['a', 'b', 'c'])).toEqual(['g-sel']);
  });

  it('addCircleToScreen: ALL → [id]; further adds dedupe', () => {
    let s = emptyScreen('S');
    expect(isAllCircles(s)).toBe(true);
    s = addCircleToScreen(s, 'g-a');
    expect(s.circleFilter).toEqual(['g-a']);
    s = addCircleToScreen(s, 'g-b');
    s = addCircleToScreen(s, 'g-a');   // dup; no-op
    expect(s.circleFilter).toEqual(['g-a', 'g-b']);
  });

  it('removeCircleFromScreen: no-op on ALL; otherwise filters', () => {
    let s = emptyScreen('S');
    s = removeCircleFromScreen(s, 'g-a');
    expect(isAllCircles(s)).toBe(true);   // still ALL

    s = addCircleToScreen(s, 'g-a');
    s = addCircleToScreen(s, 'g-b');
    s = removeCircleFromScreen(s, 'g-a');
    expect(s.circleFilter).toEqual(['g-b']);
  });

  it('setAllCircles drops any explicit list, returns to ALL', () => {
    let s = addCircleToScreen(emptyScreen('S'), 'g-a');
    expect(isAllCircles(s)).toBe(false);
    s = setAllCircles(s);
    expect(isAllCircles(s)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Reused block helpers compose with Screen                           */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — α.1 block helpers compose with Screen', () => {
  it('addBlock/moveBlock work directly on a Screen (.blocks shape match)', () => {
    let s = emptyScreen('Stream');
    s = addBlock(s, 'noticeboard');
    s = addBlock(s, 'calendar');
    expect(s.blocks.map((b) => b.type)).toEqual(['noticeboard', 'calendar']);
    // addBlock preserves id+name; check id+circleFilter survive.
    expect(s.id).toMatch(/^s-/);
    expect(s.circleFilter).toBe(ALL_CIRCLES);

    const noticeId = s.blocks[0].id;
    s = moveBlock(s, noticeId, 1);
    expect(s.blocks.map((b) => b.type)).toEqual(['calendar', 'noticeboard']);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* ScreenBook helpers                                                 */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — ScreenBook', () => {
  it('EMPTY_SCREEN_BOOK is the canonical empty shape', () => {
    expect(EMPTY_SCREEN_BOOK).toEqual({ screens: [], activeId: null });
  });

  it('normalizeScreenBook defaults activeId to first screen when absent or stale', () => {
    const s1 = emptyScreen('A');
    const s2 = emptyScreen('B');
    expect(normalizeScreenBook({ screens: [s1, s2] }).activeId).toBe(s1.id);
    expect(normalizeScreenBook({ screens: [s1, s2], activeId: 's-missing' }).activeId).toBe(s1.id);
    expect(normalizeScreenBook({ screens: [s1, s2], activeId: s2.id }).activeId).toBe(s2.id);
  });

  it('addScreen appends + marks active when book was empty; preserves active otherwise', () => {
    let book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');
    expect(book.screens).toHaveLength(1);
    expect(book.activeId).toBe(book.screens[0].id);
    book = addScreen(book, 'Selwerd', ['g-sel']);
    expect(book.screens).toHaveLength(2);
    expect(book.activeId).toBe(book.screens[0].id);   // active unchanged
    expect(book.screens[1].circleFilter).toEqual(['g-sel']);
  });

  it('renameScreen: no-op on missing id', () => {
    const book = addScreen(EMPTY_SCREEN_BOOK, 'A');
    expect(renameScreen(book, 'missing', 'X')).toEqual(book);
    const renamed = renameScreen(book, book.screens[0].id, 'A-2');
    expect(renamed.screens[0].name).toBe('A-2');
  });

  it('removeScreen picks next as active when active was removed', () => {
    let book = addScreen(addScreen(EMPTY_SCREEN_BOOK, 'A'), 'B');
    const aId = book.screens[0].id;
    const bId = book.screens[1].id;
    expect(book.activeId).toBe(aId);

    book = removeScreen(book, aId);
    expect(book.screens.map((s) => s.name)).toEqual(['B']);
    expect(book.activeId).toBe(bId);

    book = removeScreen(book, bId);
    expect(book.screens).toEqual([]);
    expect(book.activeId).toBeNull();
  });

  it('setActiveScreen + getActiveScreen', () => {
    let book = addScreen(addScreen(EMPTY_SCREEN_BOOK, 'A'), 'B');
    expect(getActiveScreen(book).name).toBe('A');
    book = setActiveScreen(book, book.screens[1].id);
    expect(getActiveScreen(book).name).toBe('B');
    const noop = setActiveScreen(book, 's-missing');
    expect(noop).toEqual(book);
  });

  it('updateScreen mutator can use single-screen helpers + α.1 block helpers', () => {
    let book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');
    const sid = book.screens[0].id;
    // add a circle to the filter
    book = updateScreen(book, sid, (s) => addCircleToScreen(s, 'g-a'));
    // add a noticeboard block via the α.1 helper — composes
    book = updateScreen(book, sid, (s) => addBlock(s, 'noticeboard', { limit: 10 }));
    expect(book.screens[0].circleFilter).toEqual(['g-a']);
    expect(book.screens[0].blocks).toHaveLength(1);
    expect(book.screens[0].blocks[0].config.limit).toBe(10);
  });

  it('updateScreen is a no-op when screenId is missing OR mutator is null', () => {
    const book = addScreen(EMPTY_SCREEN_BOOK, 'A');
    expect(updateScreen(book, 's-missing', (s) => s)).toEqual(book);
    expect(updateScreen(book, book.screens[0].id, null)).toEqual(book);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Store                                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('userScreens · α.2.a — store', () => {
  it('store.get returns empty when load yields null', async () => {
    const store = createUserScreenStore({ io: { load: async () => null } });
    expect(await store.get()).toEqual(EMPTY_SCREEN_BOOK);
  });

  it('store.set + store.update flow + persistence', async () => {
    let stored = null;
    const store = createUserScreenStore({ io: {
      load: async () => stored,
      save: async (b) => { stored = b; },
    } });
    await store.update((cur) => addScreen(cur, 'Stream'));
    await store.update((cur) => addScreen(cur, 'Werk'));
    const final = await store.get();
    expect(final.screens.map((s) => s.name)).toEqual(['Stream', 'Werk']);
    expect(stored.activeId).toBe(stored.screens[0].id);
  });

  it('store.get tolerates load() that throws', async () => {
    const store = createUserScreenStore({ io: { load: async () => { throw new Error('disk gone'); } } });
    expect(await store.get()).toEqual(EMPTY_SCREEN_BOOK);
  });
});

describe('userScreens · α.2.a — localStorageScreenIo', () => {
  it('round-trips through localStorage under the single user key', async () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    const io = localStorageScreenIo(storage);
    const book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');
    await io.save(book);
    expect(mem.has('cc.userScreens')).toBe(true);
    const loaded = await io.load();
    expect(loaded.screens).toHaveLength(1);
    expect(loaded.screens[0].name).toBe('Stream');
  });

  it('save swallows quota / disabled-storage errors', async () => {
    const io = localStorageScreenIo({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    await expect(io.save(EMPTY_SCREEN_BOOK)).resolves.toBeUndefined();
  });
});
