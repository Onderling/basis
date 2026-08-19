// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderScreensPicker } from '../../web/v2/circleScreensPicker.js';
import {
  emptyScreen, addCircleToScreen, addScreen, setActiveScreen, EMPTY_SCREEN_BOOK,
} from '../../src/v2/userScreens.js';

const t = (key, params) =>
  params && params.name != null ? `${key}:${params.name}`
  : params && params.count != null ? `${key}:${params.count}`
  : key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  delete globalThis.prompt;
  delete globalThis.confirm;
});

/* ─────────────────────────────────────────────────────────────────── */

describe('renderScreensPicker · α.3.1 — shell + empty state', () => {
  it('renders the picker title + classes the container', () => {
    const el = mount();
    renderScreensPicker(el, { book: EMPTY_SCREEN_BOOK, t });
    expect(el.classList.contains('circle-screens-picker')).toBe(true);
    expect(el.querySelector('.circle-screens-picker__title').textContent).toBe('circle.screens.picker_title');
  });

  it('shows the empty-state when the book has no screens', () => {
    const el = mount();
    renderScreensPicker(el, { book: EMPTY_SCREEN_BOOK, t });
    expect(el.querySelector('.circle-screens-picker__empty').textContent).toBe('circle.screens.no_screens');
  });

  it('always renders the add-screen input + button', () => {
    const el = mount();
    renderScreensPicker(el, { book: EMPTY_SCREEN_BOOK, t });
    expect(el.querySelector('.circle-screens-picker__add-input')).not.toBeNull();
    expect(el.querySelector('.circle-screens-picker__add-btn').textContent).toBe('circle.screens.add');
  });
});

describe('renderScreensPicker · α.3.1 — rows', () => {
  it('renders one row per screen with the active badge on the active id', () => {
    const book = setActiveScreen(addScreen(addScreen(EMPTY_SCREEN_BOOK, 'Stream'), 'Werk'),
                                /* will set after addScreen returns */ '');
    // Patch the active id to the second screen.
    const real = addScreen(addScreen(EMPTY_SCREEN_BOOK, 'Stream'), 'Werk');
    const active2 = setActiveScreen(real, real.screens[1].id);

    const el = mount();
    renderScreensPicker(el, { book: active2, t });
    const rows = el.querySelectorAll('.circle-screens-picker__row');
    expect(rows).toHaveLength(2);
    expect(rows[1].classList.contains('is-active')).toBe(true);
    expect(rows[1].querySelector('.circle-screens-picker__active-badge').textContent)
      .toBe('circle.screens.active');
  });

  it('shows filter summary per row (all / one / n)', () => {
    let book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');      // ALL_CIRCLES
    book = addScreen(book, 'Selwerd', ['g-sel']);          // one
    book = addScreen(book, 'Multi', ['g-a', 'g-b', 'g-c']); // n=3
    const el = mount();
    renderScreensPicker(el, { book, t });
    const rows = el.querySelectorAll('.circle-screens-picker__row');
    const summaries = [...rows].map((r) =>
      r.querySelector('.circle-screens-picker__summary').textContent);
    expect(summaries[0]).toBe('circle.screens.filter_all');
    expect(summaries[1]).toBe('circle.screens.filter_one');
    expect(summaries[2]).toBe('circle.screens.filter_n:3');
  });

  it('tapping the name button fires onOpenScreen with the id', () => {
    const onOpenScreen = vi.fn();
    const book = addScreen(EMPTY_SCREEN_BOOK, 'Stream');
    const el = mount();
    renderScreensPicker(el, { book, t, onOpenScreen });
    el.querySelector('.circle-screens-picker__name').click();
    expect(onOpenScreen).toHaveBeenCalledWith(book.screens[0].id);
  });
});

describe('renderScreensPicker · α.3.1 — actions', () => {
  it('add: enter name → fires onAddScreen + clears the input', () => {
    const onAddScreen = vi.fn();
    const el = mount();
    renderScreensPicker(el, { book: EMPTY_SCREEN_BOOK, t, onAddScreen });
    const input = el.querySelector('.circle-screens-picker__add-input');
    input.value = '  My Stream  ';
    el.querySelector('.circle-screens-picker__add-btn').click();
    expect(onAddScreen).toHaveBeenCalledWith('My Stream');
    expect(input.value).toBe('');
  });

  it('add: blank input → no-op', () => {
    const onAddScreen = vi.fn();
    const el = mount();
    renderScreensPicker(el, { book: EMPTY_SCREEN_BOOK, t, onAddScreen });
    el.querySelector('.circle-screens-picker__add-btn').click();
    expect(onAddScreen).not.toHaveBeenCalled();
  });

  it('rename uses globalThis.prompt + fires onRenameScreen with trimmed value', () => {
    globalThis.prompt = vi.fn(() => '  New name  ');
    const onRenameScreen = vi.fn();
    const book = addScreen(EMPTY_SCREEN_BOOK, 'Old');
    const el = mount();
    renderScreensPicker(el, { book, t, onRenameScreen });
    el.querySelector('.circle-screens-picker__rename').click();
    expect(onRenameScreen).toHaveBeenCalledWith(book.screens[0].id, 'New name');
  });

  it('rename: cancelled prompt or unchanged → no-op', () => {
    const onRenameScreen = vi.fn();
    const book = addScreen(EMPTY_SCREEN_BOOK, 'Old');
    const el = mount();
    renderScreensPicker(el, { book, t, onRenameScreen });

    globalThis.prompt = vi.fn(() => null);
    el.querySelector('.circle-screens-picker__rename').click();
    expect(onRenameScreen).not.toHaveBeenCalled();

    globalThis.prompt = vi.fn(() => 'Old');
    el.querySelector('.circle-screens-picker__rename').click();
    expect(onRenameScreen).not.toHaveBeenCalled();
  });

  it('set-active appears only on inactive rows; fires onSetActive', () => {
    const onSetActive = vi.fn();
    const real = addScreen(addScreen(EMPTY_SCREEN_BOOK, 'A'), 'B');
    const el = mount();
    renderScreensPicker(el, { book: real, t, onSetActive });
    const rows = el.querySelectorAll('.circle-screens-picker__row');
    expect(rows[0].querySelector('.circle-screens-picker__activate')).toBeNull();   // active
    const btn = rows[1].querySelector('.circle-screens-picker__activate');
    expect(btn).not.toBeNull();
    btn.click();
    expect(onSetActive).toHaveBeenCalledWith(real.screens[1].id);
  });

  it('delete asks confirm() + fires onRemoveScreen on yes', () => {
    globalThis.confirm = vi.fn(() => true);
    const onRemoveScreen = vi.fn();
    const book = addScreen(EMPTY_SCREEN_BOOK, 'doomed');
    const el = mount();
    renderScreensPicker(el, { book, t, onRemoveScreen });
    el.querySelector('.circle-screens-picker__remove').click();
    expect(globalThis.confirm).toHaveBeenCalled();
    expect(onRemoveScreen).toHaveBeenCalledWith(book.screens[0].id);
  });

  it('delete skips onRemoveScreen when confirm() returns false', () => {
    globalThis.confirm = vi.fn(() => false);
    const onRemoveScreen = vi.fn();
    const book = addScreen(EMPTY_SCREEN_BOOK, 'safe');
    const el = mount();
    renderScreensPicker(el, { book, t, onRemoveScreen });
    el.querySelector('.circle-screens-picker__remove').click();
    expect(onRemoveScreen).not.toHaveBeenCalled();
  });
});
