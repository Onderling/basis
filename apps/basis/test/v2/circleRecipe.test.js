// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  BLOCK_TYPES, EMPTY_RECIPE_BOOK,
  emptyRecipe, normalizeRecipe, defaultConfigForBlock,
  addBlock, removeBlock, moveBlock, updateBlock,
  normalizeRecipeBook,
  addRecipe, renameRecipe, removeRecipe,
  setActiveRecipe, getActiveRecipe, updateRecipe,
  createCircleRecipeStore, localStorageRecipeIo,
} from '../../src/v2/circleRecipe.js';

/* ─────────────────────────────────────────────────────────────────── */
/* Single-recipe helpers                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('circleRecipe · α.1a — single Recipe', () => {
  it('exposes the v2 §2 block palette in editor order', () => {
    // α.4 added 'tasks' between agenda and rules.
    // D1 (§5A) prepended 'quickActions' as the top "Veel-gebruikt" rail.
    expect(BLOCK_TYPES).toEqual([
      'quickActions', 'announcement', 'noticeboard', 'agenda', 'tasks', 'rules', 'photo', 'text',
    ]);
  });

  it('emptyRecipe() mints a fresh id + carries the name', () => {
    const r = emptyRecipe('Standaard');
    expect(r).toMatchObject({ name: 'Standaard', blocks: [] });
    expect(r.id).toMatch(/^r-/);
    expect(emptyRecipe().id).not.toBe(r.id);
  });

  it('normalizeRecipe coerces junk to an empty recipe (with fresh id)', () => {
    const r = normalizeRecipe(null);
    expect(r.blocks).toEqual([]);
    expect(r.name).toBe('');
    expect(r.id).toMatch(/^r-/);
  });

  it('normalizeRecipe drops unknown block types (forward-compat)', () => {
    const r = normalizeRecipe({
      id: 'r-1', name: 'X',
      blocks: [
        { id: 'b1', type: 'announcement', config: { text: 'hi' } },
        { id: 'b2', type: 'future-block-from-v3', config: {} },
        { id: 'b3', type: 'photo', config: { src: '/x.jpg' } },
      ],
    });
    expect(r.id).toBe('r-1');
    expect(r.name).toBe('X');
    expect(r.blocks.map((b) => b.type)).toEqual(['announcement', 'photo']);
  });

  it('defaultConfigForBlock returns fresh per-type defaults', () => {
    // α.5c — the four list-shaped types (announcement, noticeboard,
    // agenda, tasks) carry a `compact:false` default so the editor's
    // Compact toggle has a defined starting state.  rules/photo/text
    // are not list-shaped and deliberately omit the key.
    expect(defaultConfigForBlock('announcement')).toEqual({ text: '', compact: false });
    expect(defaultConfigForBlock('noticeboard')).toEqual({ limit: 5, compact: false });
    expect(defaultConfigForBlock('agenda')).toEqual({ limit: 5, horizonDays: 14, compact: false });
    expect(defaultConfigForBlock('tasks')).toEqual({ scope: 'assigned-to-me', limit: 10, compact: false });
    expect(defaultConfigForBlock('rules')).toEqual({});
    expect(defaultConfigForBlock('photo')).toEqual({ src: '', caption: '' });
    expect(defaultConfigForBlock('text')).toEqual({ text: '' });
  });

  it('α.5c — DEFAULT_CONFIGS: list-shaped types include compact:false, others omit it', () => {
    // Mirrors the renderer/editor convention: only the four list-shaped
    // types expose the Compact toggle.
    for (const t of ['announcement', 'noticeboard', 'agenda', 'tasks']) {
      const cfg = defaultConfigForBlock(t);
      expect(cfg).toHaveProperty('compact', false);
    }
    for (const t of ['rules', 'photo', 'text']) {
      const cfg = defaultConfigForBlock(t);
      expect(Object.prototype.hasOwnProperty.call(cfg, 'compact')).toBe(false);
    }
  });

  it('addBlock preserves id+name on the returned Recipe', () => {
    const r0 = emptyRecipe('Standaard');
    const r1 = addBlock(r0, 'announcement', { text: 'hi' });
    expect(r1.id).toBe(r0.id);
    expect(r1.name).toBe('Standaard');
    expect(r1.blocks).toHaveLength(1);
    expect(r1.blocks[0]).toMatchObject({ type: 'announcement', config: { text: 'hi' } });
  });

  it('addBlock throws on unknown type', () => {
    expect(() => addBlock(emptyRecipe(), 'nonsense')).toThrow(/unknown block type/);
  });

  it('removeBlock / moveBlock / updateBlock preserve id+name', () => {
    let r = addBlock(addBlock(addBlock(emptyRecipe('X'), 'announcement'), 'photo'), 'text');
    const recipeId = r.id;
    const lastBlockId = r.blocks[2].id;

    r = moveBlock(r, lastBlockId, 0);
    expect(r.id).toBe(recipeId);
    expect(r.name).toBe('X');
    expect(r.blocks.map((b) => b.type)).toEqual(['text', 'announcement', 'photo']);

    r = updateBlock(r, r.blocks[0].id, { text: 'updated' });
    expect(r.blocks[0].config.text).toBe('updated');

    r = removeBlock(r, r.blocks[2].id);
    expect(r.id).toBe(recipeId);
    expect(r.blocks).toHaveLength(2);
  });

  it('moveBlock clamps out-of-range indices', () => {
    let r = addBlock(addBlock(emptyRecipe(), 'announcement'), 'text');
    const firstId = r.blocks[0].id;
    r = moveBlock(r, firstId, 99);
    expect(r.blocks.map((b) => b.type)).toEqual(['text', 'announcement']);
  });

  it('updateBlock no-ops when blockId is missing', () => {
    const r = addBlock(emptyRecipe(), 'text', { text: 'hi' });
    const r2 = updateBlock(r, 'b-missing', { text: 'changed' });
    expect(r2).toEqual(r);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* RecipeBook helpers                                                 */
/* ─────────────────────────────────────────────────────────────────── */

describe('circleRecipe · α.1a — RecipeBook', () => {
  it('EMPTY_RECIPE_BOOK is the canonical empty shape', () => {
    expect(EMPTY_RECIPE_BOOK).toEqual({ recipes: [], activeId: null });
  });

  it('normalizeRecipeBook coerces junk to the empty shape', () => {
    expect(normalizeRecipeBook(null)).toEqual({ recipes: [], activeId: null });
    expect(normalizeRecipeBook({})).toEqual({ recipes: [], activeId: null });
    expect(normalizeRecipeBook({ recipes: 'oops' })).toEqual({ recipes: [], activeId: null });
  });

  it('normalizeRecipeBook defaults activeId to the first recipe when absent or stale', () => {
    const r1 = emptyRecipe('A');
    const r2 = emptyRecipe('B');
    const book1 = normalizeRecipeBook({ recipes: [r1, r2] });
    expect(book1.activeId).toBe(r1.id);

    const book2 = normalizeRecipeBook({ recipes: [r1, r2], activeId: 'r-not-here' });
    expect(book2.activeId).toBe(r1.id);

    const book3 = normalizeRecipeBook({ recipes: [r1, r2], activeId: r2.id });
    expect(book3.activeId).toBe(r2.id);
  });

  it('addRecipe appends + marks active when the book was empty', () => {
    const book = addRecipe(EMPTY_RECIPE_BOOK, 'Standaard');
    expect(book.recipes).toHaveLength(1);
    expect(book.recipes[0].name).toBe('Standaard');
    expect(book.activeId).toBe(book.recipes[0].id);

    const book2 = addRecipe(book, 'Eventfocus');
    expect(book2.recipes.map((r) => r.name)).toEqual(['Standaard', 'Eventfocus']);
    expect(book2.activeId).toBe(book.activeId);  // active unchanged
  });

  it('renameRecipe rewrites just the name; no-op on missing id', () => {
    let book = addRecipe(addRecipe(EMPTY_RECIPE_BOOK, 'A'), 'B');
    const targetId = book.recipes[0].id;
    book = renameRecipe(book, targetId, 'A-updated');
    expect(book.recipes[0].name).toBe('A-updated');
    expect(book.recipes[1].name).toBe('B');

    const noop = renameRecipe(book, 'r-missing', 'X');
    expect(noop).toEqual(book);
  });

  it('removeRecipe drops the entry + picks new active when the removed was active', () => {
    let book = addRecipe(addRecipe(addRecipe(EMPTY_RECIPE_BOOK, 'A'), 'B'), 'C');
    const aId = book.recipes[0].id;
    const bId = book.recipes[1].id;
    const cId = book.recipes[2].id;
    expect(book.activeId).toBe(aId);

    book = removeRecipe(book, aId);
    expect(book.recipes.map((r) => r.name)).toEqual(['B', 'C']);
    expect(book.activeId).toBe(bId);

    // Removing a non-active recipe leaves activeId alone.
    book = removeRecipe(book, cId);
    expect(book.recipes.map((r) => r.name)).toEqual(['B']);
    expect(book.activeId).toBe(bId);

    // Removing the last recipe nulls activeId.
    book = removeRecipe(book, bId);
    expect(book.recipes).toEqual([]);
    expect(book.activeId).toBeNull();
  });

  it('setActiveRecipe switches active; no-op on missing id', () => {
    let book = addRecipe(addRecipe(EMPTY_RECIPE_BOOK, 'A'), 'B');
    const bId = book.recipes[1].id;
    book = setActiveRecipe(book, bId);
    expect(book.activeId).toBe(bId);

    const noop = setActiveRecipe(book, 'r-missing');
    expect(noop).toEqual(book);
  });

  it('getActiveRecipe returns the active Recipe (or null when empty)', () => {
    expect(getActiveRecipe(EMPTY_RECIPE_BOOK)).toBeNull();
    const book = addRecipe(EMPTY_RECIPE_BOOK, 'Standaard');
    const active = getActiveRecipe(book);
    expect(active?.name).toBe('Standaard');
  });

  it('updateRecipe applies a mutator to the targeted recipe only', () => {
    let book = addRecipe(addRecipe(EMPTY_RECIPE_BOOK, 'A'), 'B');
    const aId = book.recipes[0].id;
    book = updateRecipe(book, aId, (r) => addBlock(r, 'announcement', { text: 'hi' }));
    expect(book.recipes[0].blocks).toHaveLength(1);
    expect(book.recipes[1].blocks).toHaveLength(0);
  });

  it('updateRecipe is a no-op on missing recipeId or missing mutator', () => {
    const book = addRecipe(EMPTY_RECIPE_BOOK, 'A');
    expect(updateRecipe(book, 'r-missing', (r) => r)).toEqual(book);
    expect(updateRecipe(book, book.recipes[0].id, null)).toEqual(book);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Store                                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('circleRecipe · α.1a — store', () => {
  it('store.get returns the empty book when load yields null', async () => {
    const store = createCircleRecipeStore({ io: { load: async () => null } });
    expect(await store.get('g1')).toEqual(EMPTY_RECIPE_BOOK);
  });

  it('store.get normalizes dirty / legacy payloads', async () => {
    const store = createCircleRecipeStore({ io: {
      load: async () => ({ recipes: [
        { id: 'r-a', name: 'A', blocks: [{ type: 'announcement', config: {} }] },
        { type: 'garbage-recipe' },   // dropped on read? actually normalize keeps it as empty recipe
      ], activeId: 'r-a' }),
    } });
    const book = await store.get('g1');
    // Both entries normalize to recipes (garbage one just gets a fresh id + 0 blocks).
    expect(book.recipes).toHaveLength(2);
    expect(book.recipes[0].name).toBe('A');
    expect(book.activeId).toBe('r-a');
  });

  it('store.set normalizes + persists via save', async () => {
    let stored = null;
    const store = createCircleRecipeStore({ io: {
      load: async () => stored,
      save: async (_id, b) => { stored = b; },
    } });
    const built = addRecipe(EMPTY_RECIPE_BOOK, 'Standaard');
    await store.set('g1', built);
    expect(stored.recipes).toHaveLength(1);
    expect(stored.activeId).toBe(stored.recipes[0].id);
  });

  it('store.update accepts a mutator over the current book', async () => {
    let stored = EMPTY_RECIPE_BOOK;
    const store = createCircleRecipeStore({ io: {
      load: async () => stored,
      save: async (_id, b) => { stored = b; },
    } });
    await store.update('g1', (cur) => addRecipe(cur, 'Standaard'));
    await store.update('g1', (cur) => addRecipe(cur, 'Eventfocus'));
    const final = await store.get('g1');
    expect(final.recipes.map((r) => r.name)).toEqual(['Standaard', 'Eventfocus']);
    expect(final.activeId).toBe(final.recipes[0].id);
  });

  it('store.get tolerates a load() that throws', async () => {
    const store = createCircleRecipeStore({ io: { load: async () => { throw new Error('disk gone'); } } });
    expect(await store.get('g1')).toEqual(EMPTY_RECIPE_BOOK);
  });
});

describe('circleRecipe · α.1a — localStorageRecipeIo', () => {
  it('round-trips through localStorage under the expected key', async () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    const io = localStorageRecipeIo(storage);
    const book = addRecipe(EMPTY_RECIPE_BOOK, 'A');
    await io.save('g42', book);
    expect(mem.has('cc.circleRecipe.g42')).toBe(true);
    const loaded = await io.load('g42');
    expect(loaded.recipes).toHaveLength(1);
    expect(loaded.recipes[0].name).toBe('A');
  });

  it('load returns null when key is absent', async () => {
    const io = localStorageRecipeIo({ getItem: () => null, setItem: () => {} });
    expect(await io.load('nope')).toBeNull();
  });

  it('save swallows quota / disabled-storage errors', async () => {
    const io = localStorageRecipeIo({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    await expect(io.save('g1', EMPTY_RECIPE_BOOK)).resolves.toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* γ.2 — optional `versions` adapter (additive)                       */
/* ─────────────────────────────────────────────────────────────────── */

describe('circleRecipe · γ.2 — version capture', () => {
  it('omitting `versions` keeps the pre-γ.2 behaviour (backwards compat)', async () => {
    let stored = null;
    const store = createCircleRecipeStore({ io: {
      load: async () => stored,
      save: async (_id, b) => { stored = b; },
    } });
    await store.update('g1', (cur) => addRecipe(cur, 'A'));
    expect(stored.recipes).toHaveLength(1);
    expect(await store.listVersions('g1')).toEqual([]);
  });

  it('captures BEFORE save on update + set', async () => {
    const order = [];
    const captures = [];
    const versions = {
      capture: async (id, value) => { order.push('capture'); captures.push({ id, value }); },
      list: async () => [],
    };
    const store = createCircleRecipeStore({
      io: {
        load: async () => null,
        save: async () => { order.push('save'); },
      },
      versions,
    });
    await store.update('g1', (cur) => addRecipe(cur, 'A'));
    await store.set('g1', { recipes: [], activeId: null });
    expect(order).toEqual(['capture', 'save', 'capture', 'save']);
    expect(captures).toHaveLength(2);
    expect(captures[0].id).toBe('g1');
    expect(captures[0].value.recipes).toHaveLength(1);
    expect(captures[1].value.recipes).toEqual([]);
  });

  it('listVersions delegates to the adapter', async () => {
    const versions = {
      capture: async () => {},
      list: async (id) => [{ ts: 9, sha256: 'x', value: { id } }],
    };
    const store = createCircleRecipeStore({ versions });
    expect(await store.listVersions('g1')).toEqual([{ ts: 9, sha256: 'x', value: { id: 'g1' } }]);
  });

  it('throwing capture does not break save', async () => {
    let stored = null;
    const versions = {
      capture: async () => { throw new Error('history disk gone'); },
      list: async () => [],
    };
    const store = createCircleRecipeStore({
      io: {
        load: async () => stored,
        save: async (_id, b) => { stored = b; },
      },
      versions,
    });
    await store.update('g1', (cur) => addRecipe(cur, 'A'));
    expect(stored.recipes).toHaveLength(1);
  });

  it('restoreVersion persists the restored book via the set path (capture + save)', async () => {
    const order = [];
    let stored = null;
    const snapshot = { recipes: [{ id: 'r1', name: 'Standaard', blocks: [] }], activeId: 'r1' };
    const store = createCircleRecipeStore({
      io: {
        load: async () => stored,
        save: async (_id, b) => { order.push('save'); stored = b; },
      },
      versions: {
        capture: async () => { order.push('capture'); },
        list: async () => [],
        restore: async (_id, ts) => (ts === 7 ? snapshot : null),
      },
    });
    const book = await store.restoreVersion('g1', 7);
    expect(order).toEqual(['capture', 'save']);
    expect(book.recipes).toHaveLength(1);
    expect(book.recipes[0].name).toBe('Standaard');
    expect(stored.recipes).toHaveLength(1);
  });

  it('restoreVersion returns null on a miss or when no adapter/restore is wired', async () => {
    let saveCalls = 0;
    const store = createCircleRecipeStore({
      io: { load: async () => null, save: async () => { saveCalls += 1; } },
      versions: { capture: async () => {}, list: async () => [], restore: async () => null },
    });
    expect(await store.restoreVersion('g1', 999)).toBeNull();
    expect(saveCalls).toBe(0);

    const bare = createCircleRecipeStore({ io: { load: async () => null, save: async () => {} } });
    expect(await bare.restoreVersion('g1', 1)).toBeNull();
  });
});
