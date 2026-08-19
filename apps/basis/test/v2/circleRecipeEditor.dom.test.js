// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderRecipeEditor } from '../../web/v2/circleRecipeEditor.js';
import { emptyRecipe, addRecipe, setActiveRecipe, addBlock } from '../../src/v2/circleRecipe.js';

const t = (key, params) =>
  params && params.name != null ? `${key}:${params.name}`
  : params && params.type != null ? `${key}:${params.type}`
  : key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  // restore any prompts/confirms swapped per-test
  delete globalThis.prompt;
  delete globalThis.confirm;
});

/* ─────────────────────────────────────────────────────────────────── */
/* BOOK mode                                                          */
/* ─────────────────────────────────────────────────────────────────── */

describe('renderRecipeEditor · α.1d.1 — BOOK mode', () => {
  it('renders the book title + empty state when the book has no recipes', () => {
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [], activeId: null }, t });
    expect(el.dataset.mode).toBe('book');
    expect(el.querySelector('.circle-recipe-editor__title').textContent).toBe('circle.recipe.editor.book_title');
    expect(el.querySelector('.circle-recipe-editor__recipe-empty').textContent).toBe('circle.recipe.editor.no_recipes');
  });

  it('renders one row per recipe with the active badge on the active id', () => {
    const r1 = { id: 'r1', name: 'Standard', blocks: [] };
    const r2 = { id: 'r2', name: 'Eventfocus', blocks: [] };
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [r1, r2], activeId: 'r2' }, t });
    const rows = el.querySelectorAll('.circle-recipe-editor__recipe-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.recipeId).toBe('r1');
    expect(rows[0].classList.contains('is-active')).toBe(false);
    expect(rows[1].classList.contains('is-active')).toBe(true);
    expect(rows[1].querySelector('.circle-recipe-editor__active-badge').textContent)
      .toBe('circle.recipe.editor.active');
  });

  it('tapping the recipe-name button fires onOpenRecipe with the id', () => {
    const onOpenRecipe = vi.fn();
    const r1 = { id: 'r-pick', name: 'Pick me', blocks: [] };
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [r1], activeId: 'r-pick' }, t, onOpenRecipe });
    el.querySelector('.circle-recipe-editor__recipe-name').click();
    expect(onOpenRecipe).toHaveBeenCalledTimes(1);
    expect(onOpenRecipe.mock.calls[0][0]).toBe('r-pick');
  });

  it('add-recipe input + button: enter a name → fires onAddRecipe + clears input', () => {
    const onAddRecipe = vi.fn();
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [], activeId: null }, t, onAddRecipe });
    const input = el.querySelector('.circle-recipe-editor__add-recipe-input');
    const btn = el.querySelector('.circle-recipe-editor__add-recipe-btn');
    input.value = '  My screen ';
    btn.click();
    expect(onAddRecipe).toHaveBeenCalledWith('My screen');
    expect(input.value).toBe('');
  });

  it('add-recipe button is a no-op on blank input', () => {
    const onAddRecipe = vi.fn();
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [], activeId: null }, t, onAddRecipe });
    el.querySelector('.circle-recipe-editor__add-recipe-btn').click();
    expect(onAddRecipe).not.toHaveBeenCalled();
  });

  it('rename uses globalThis.prompt + fires onRenameRecipe with the trimmed result', () => {
    globalThis.prompt = vi.fn(() => '  New name  ');
    const onRenameRecipe = vi.fn();
    const r1 = { id: 'r1', name: 'Old', blocks: [] };
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [r1], activeId: 'r1' }, t, onRenameRecipe });
    el.querySelector('.circle-recipe-editor__recipe-rename').click();
    expect(onRenameRecipe).toHaveBeenCalledWith('r1', 'New name');
  });

  it('rename: cancelled prompt or unchanged value → no-op', () => {
    const onRenameRecipe = vi.fn();
    const r1 = { id: 'r1', name: 'Old', blocks: [] };
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [r1], activeId: 'r1' }, t, onRenameRecipe });

    // Cancelled.
    globalThis.prompt = vi.fn(() => null);
    el.querySelector('.circle-recipe-editor__recipe-rename').click();
    expect(onRenameRecipe).not.toHaveBeenCalled();

    // Unchanged after trim.
    globalThis.prompt = vi.fn(() => 'Old');
    el.querySelector('.circle-recipe-editor__recipe-rename').click();
    expect(onRenameRecipe).not.toHaveBeenCalled();
  });

  it('set-active button appears only on inactive recipes; fires onSetActive', () => {
    const onSetActive = vi.fn();
    const r1 = { id: 'r1', name: 'A', blocks: [] };
    const r2 = { id: 'r2', name: 'B', blocks: [] };
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [r1, r2], activeId: 'r1' }, t, onSetActive });
    const rows = el.querySelectorAll('.circle-recipe-editor__recipe-row');
    expect(rows[0].querySelector('.circle-recipe-editor__recipe-activate')).toBeNull();
    const inactiveBtn = rows[1].querySelector('.circle-recipe-editor__recipe-activate');
    expect(inactiveBtn).not.toBeNull();
    inactiveBtn.click();
    expect(onSetActive).toHaveBeenCalledWith('r2');
  });

  it('delete button asks confirm() + fires onRemoveRecipe on yes', () => {
    globalThis.confirm = vi.fn(() => true);
    const onRemoveRecipe = vi.fn();
    const r1 = { id: 'r1', name: 'doomed', blocks: [] };
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [r1], activeId: 'r1' }, t, onRemoveRecipe });
    el.querySelector('.circle-recipe-editor__recipe-remove').click();
    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    expect(onRemoveRecipe).toHaveBeenCalledWith('r1');
  });

  it('delete button skips onRemoveRecipe when confirm() returns false', () => {
    globalThis.confirm = vi.fn(() => false);
    const onRemoveRecipe = vi.fn();
    const r1 = { id: 'r1', name: 'safe', blocks: [] };
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [r1], activeId: 'r1' }, t, onRemoveRecipe });
    el.querySelector('.circle-recipe-editor__recipe-remove').click();
    expect(onRemoveRecipe).not.toHaveBeenCalled();
  });

  it('back button fires onBack', () => {
    const onBack = vi.fn();
    const el = mount();
    renderRecipeEditor(el, { book: { recipes: [], activeId: null }, t, onBack });
    el.querySelector('.circle-recipe-editor__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* RECIPE mode                                                        */
/* ─────────────────────────────────────────────────────────────────── */

describe('renderRecipeEditor · α.1d.1 — RECIPE mode', () => {
  function bookWithBlocks() {
    let r = addBlock(addBlock(addBlock(emptyRecipe('Std'), 'announcement', { text: 'Hi' }), 'text'), 'photo');
    return { book: { recipes: [r], activeId: r.id }, recipe: r };
  }

  it('renders the recipe title + ordered block list', () => {
    const { book, recipe } = bookWithBlocks();
    const el = mount();
    renderRecipeEditor(el, { book, mode: 'recipe', editingRecipeId: recipe.id, t });
    expect(el.dataset.mode).toBe('recipe');
    expect(el.querySelector('.circle-recipe-editor__recipe-title').textContent).toBe('Std');
    const blocks = el.querySelectorAll('.circle-recipe-editor__block-row');
    expect(blocks).toHaveLength(3);
    expect([...blocks].map((b) => b.dataset.blockType))
      .toEqual(['announcement', 'text', 'photo']);
  });

  it('stale editingRecipeId falls back to the "missing" message', () => {
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [], activeId: null }, mode: 'recipe', editingRecipeId: 'r-gone', t,
    });
    expect(el.querySelector('.circle-recipe-editor__missing').textContent)
      .toBe('circle.recipe.editor.recipe_missing');
  });

  it('block palette shows one button per BLOCK_TYPE; click fires onAddBlock', () => {
    const onAddBlock = vi.fn();
    const r = emptyRecipe('A');
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [r], activeId: r.id }, mode: 'recipe',
      editingRecipeId: r.id, t, onAddBlock,
    });
    const buttons = el.querySelectorAll('.circle-recipe-editor__palette-btn');
    expect(buttons.length).toBe(8);  // 8 BLOCK_TYPES (α.4 added 'tasks'; D1 added 'quickActions')
    buttons[0].click();   // first in registry order = quickActions (order 0)
    expect(onAddBlock).toHaveBeenCalledWith(r.id, 'quickActions');
  });

  it('up/down buttons fire onMoveBlock with the right adjacent index', () => {
    const onMoveBlock = vi.fn();
    const { book, recipe } = bookWithBlocks();
    const el = mount();
    renderRecipeEditor(el, { book, mode: 'recipe', editingRecipeId: recipe.id, t, onMoveBlock });
    const rows = el.querySelectorAll('.circle-recipe-editor__block-row');
    const middleId = rows[1].dataset.blockId;
    rows[1].querySelector('.circle-recipe-editor__block-up').click();
    expect(onMoveBlock).toHaveBeenLastCalledWith(recipe.id, middleId, 0);
    rows[1].querySelector('.circle-recipe-editor__block-down').click();
    expect(onMoveBlock).toHaveBeenLastCalledWith(recipe.id, middleId, 2);
  });

  it('up button is disabled on the first block; down on the last', () => {
    const { book, recipe } = bookWithBlocks();
    const el = mount();
    renderRecipeEditor(el, { book, mode: 'recipe', editingRecipeId: recipe.id, t });
    const rows = el.querySelectorAll('.circle-recipe-editor__block-row');
    expect(rows[0].querySelector('.circle-recipe-editor__block-up').disabled).toBe(true);
    expect(rows[2].querySelector('.circle-recipe-editor__block-down').disabled).toBe(true);
  });

  it('× button fires onRemoveBlock with recipeId + blockId', () => {
    const onRemoveBlock = vi.fn();
    const { book, recipe } = bookWithBlocks();
    const el = mount();
    renderRecipeEditor(el, { book, mode: 'recipe', editingRecipeId: recipe.id, t, onRemoveBlock });
    const firstId = recipe.blocks[0].id;
    el.querySelectorAll('.circle-recipe-editor__block-remove')[0].click();
    expect(onRemoveBlock).toHaveBeenCalledWith(recipe.id, firstId);
  });

  it('announcement/text edit: typing fires onUpdateBlock with {text}', () => {
    const onUpdateBlock = vi.fn();
    const r = addBlock(emptyRecipe('A'), 'announcement', { text: 'old' });
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [r], activeId: r.id }, mode: 'recipe',
      editingRecipeId: r.id, t, onUpdateBlock,
    });
    const area = el.querySelector('.circle-recipe-editor__block-textarea');
    expect(area.value).toBe('old');
    area.value = 'new value';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onUpdateBlock).toHaveBeenCalledWith(r.id, r.blocks[0].id, { text: 'new value' });
  });

  it('photo edit: src + caption inputs fire onUpdateBlock separately', () => {
    const onUpdateBlock = vi.fn();
    const r = addBlock(emptyRecipe('A'), 'photo', { src: '/a.jpg', caption: '' });
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [r], activeId: r.id }, mode: 'recipe',
      editingRecipeId: r.id, t, onUpdateBlock,
    });
    const inputs = el.querySelectorAll('.circle-recipe-editor__block-input');
    expect(inputs).toHaveLength(2);
    inputs[1].value = 'feest';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    expect(onUpdateBlock).toHaveBeenCalledWith(r.id, r.blocks[0].id, { caption: 'feest' });
  });

  it('agenda block: two limit fields (limit + horizonDays)', () => {
    const r = addBlock(emptyRecipe('A'), 'agenda');
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [r], activeId: r.id }, mode: 'recipe',
      editingRecipeId: r.id, t,
    });
    const inputs = el.querySelectorAll('.circle-recipe-editor__limit-input');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].dataset.configKey).toBe('limit');
    expect(inputs[1].dataset.configKey).toBe('horizonDays');
  });

  it('α.5c — noticeboard block exposes a Compact checkbox bound to config.compact', () => {
    const onUpdateBlock = vi.fn();
    const r = addBlock(emptyRecipe('A'), 'noticeboard');
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [r], activeId: r.id }, mode: 'recipe',
      editingRecipeId: r.id, t, onUpdateBlock,
    });
    const cb = el.querySelector('.circle-recipe-editor__compact-checkbox');
    expect(cb).not.toBeNull();
    expect(cb.checked).toBe(false);              // default
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdateBlock).toHaveBeenCalledWith(r.id, r.blocks[0].id, { compact: true });
  });

  it('α.5c — Compact checkbox appears on every list-shaped block type (announcement/noticeboard/agenda/tasks)', () => {
    for (const type of ['announcement', 'noticeboard', 'agenda', 'tasks']) {
      const r = addBlock(emptyRecipe('A'), type);
      const el = mount();
      renderRecipeEditor(el, {
        book: { recipes: [r], activeId: r.id }, mode: 'recipe',
        editingRecipeId: r.id, t,
      });
      expect(el.querySelector('.circle-recipe-editor__compact-checkbox'), `missing on ${type}`).not.toBeNull();
    }
  });

  it('α.5c — Compact checkbox does NOT appear on text or photo blocks', () => {
    for (const type of ['text', 'photo']) {
      const r = addBlock(emptyRecipe('A'), type);
      const el = mount();
      renderRecipeEditor(el, {
        book: { recipes: [r], activeId: r.id }, mode: 'recipe',
        editingRecipeId: r.id, t,
      });
      expect(el.querySelector('.circle-recipe-editor__compact-checkbox'), `unexpected on ${type}`).toBeNull();
    }
  });

  it('rules block shows a hint (no editable config)', () => {
    const r = addBlock(emptyRecipe('A'), 'rules');
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [r], activeId: r.id }, mode: 'recipe',
      editingRecipeId: r.id, t,
    });
    expect(el.querySelector('.circle-recipe-editor__block-hint').textContent)
      .toBe('circle.recipe.editor.rules_hint');
  });

  it('back-to-book button fires onBackToBook', () => {
    const onBackToBook = vi.fn();
    const r = emptyRecipe('A');
    const el = mount();
    renderRecipeEditor(el, {
      book: { recipes: [r], activeId: r.id }, mode: 'recipe',
      editingRecipeId: r.id, t, onBackToBook,
    });
    el.querySelector('.circle-recipe-editor__back').click();
    expect(onBackToBook).toHaveBeenCalledTimes(1);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Integration: helper-roundtrip                                      */
/* ─────────────────────────────────────────────────────────────────── */

describe('renderRecipeEditor · α.1d.1 — integration smoke', () => {
  it('drives a realistic add-recipe → add-block → setActive sequence host-side', () => {
    // Simulate the host's controller: own a book ref, mutate via the
    // single-recipe + book helpers, re-render after each apply.  This
    // mirrors the showRecipeEditor wiring in circleApp.js without the
    // real persistence layer.
    let book = { recipes: [], activeId: null };
    const calls = [];
    const renderOnce = () => {
      const el = mount();
      renderRecipeEditor(el, {
        book, t,
        onAddRecipe: (name) => {
          book = addRecipe(book, name);
          calls.push(['addRecipe', name]);
        },
        onSetActive: (rid) => {
          book = setActiveRecipe(book, rid);
          calls.push(['setActive', rid]);
        },
      });
      return el;
    };

    let el = renderOnce();
    el.querySelector('.circle-recipe-editor__add-recipe-input').value = 'A';
    el.querySelector('.circle-recipe-editor__add-recipe-btn').click();
    expect(book.recipes).toHaveLength(1);
    expect(book.activeId).toBe(book.recipes[0].id);
    const aId = book.recipes[0].id;

    el = renderOnce();
    el.querySelector('.circle-recipe-editor__add-recipe-input').value = 'B';
    el.querySelector('.circle-recipe-editor__add-recipe-btn').click();
    expect(book.recipes).toHaveLength(2);

    el = renderOnce();
    const inactiveRow = el.querySelectorAll('.circle-recipe-editor__recipe-row')[1];
    inactiveRow.querySelector('.circle-recipe-editor__recipe-activate').click();
    expect(book.activeId).toBe(book.recipes[1].id);
    expect(book.activeId).not.toBe(aId);
  });
});
