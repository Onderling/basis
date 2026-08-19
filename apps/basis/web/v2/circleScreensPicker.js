/**
 * basis v2 — Screens picker (Plan α.3.1).
 *
 * The Screens tab's list view: the user's screens (with active badge),
 * plus add / rename / delete / setActive / open affordances.  Pure DOM,
 * controlled-render — same shape as `circleRecipeEditor`'s book mode:
 *
 *   const root = document.createElement('div');
 *   renderScreensPicker(root, {
 *     book, t,
 *     onOpenScreen, onAddScreen, onRenameScreen, onRemoveScreen, onSetActive,
 *   });
 *
 * V0: tapping the name "opens" the screen (host shows the materialized
 * blocks).  Block-level editing inside a screen reuses the α.1d recipe
 * editor in a follow-up; for now creating a screen seeds it host-side
 * with a default noticeboard block so opening immediately shows
 * something.
 */

/**
 * @param {HTMLElement} container
 * @param {object}   args
 * @param {object}   args.book                 ScreenBook { screens, activeId }
 * @param {Function} args.t
 * @param {Function} [args.onOpenScreen]       (screenId) → void
 * @param {Function} [args.onAddScreen]        (name) → void
 * @param {Function} [args.onRenameScreen]     (screenId, name) → void
 * @param {Function} [args.onRemoveScreen]     (screenId) → void
 * @param {Function} [args.onSetActive]        (screenId) → void
 */
export function renderScreensPicker(container, {
  book = { screens: [], activeId: null },
  t,
  onOpenScreen, onAddScreen, onRenameScreen, onRemoveScreen, onSetActive,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-screens-picker');

  const title = document.createElement('h2');
  title.className = 'circle-screens-picker__title';
  title.textContent = tr('circle.screens.picker_title');
  container.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-screens-picker__list';
  if (book.screens.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'circle-screens-picker__empty';
    empty.textContent = tr('circle.screens.no_screens');
    list.appendChild(empty);
  } else {
    for (const screen of book.screens) {
      list.appendChild(renderRow(screen, {
        isActive: screen.id === book.activeId, tr,
        onOpenScreen, onRenameScreen, onRemoveScreen, onSetActive,
      }));
    }
  }
  container.appendChild(list);

  // Add-screen row pinned at the bottom; auto-naming is host-side
  // (host gets the trimmed value here and decides how to seed).
  const addRow = document.createElement('div');
  addRow.className = 'circle-screens-picker__add';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'circle-screens-picker__add-input';
  addInput.placeholder = tr('circle.screens.add_placeholder');
  addRow.appendChild(addInput);
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'circle-screens-picker__add-btn';
  addBtn.textContent = tr('circle.screens.add');
  addBtn.addEventListener('click', () => {
    const name = addInput.value.trim();
    if (!name) return;
    onAddScreen?.(name);
    addInput.value = '';
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
  return container;
}

/* ─────────────────────────────────────────────────────────────────────── */

function renderRow(screen, {
  isActive, tr,
  onOpenScreen, onRenameScreen, onRemoveScreen, onSetActive,
}) {
  const li = document.createElement('li');
  li.className = 'circle-screens-picker__row';
  li.dataset.screenId = screen.id;
  if (isActive) li.classList.add('is-active');

  const nameBtn = document.createElement('button');
  nameBtn.type = 'button';
  nameBtn.className = 'circle-screens-picker__name';
  nameBtn.textContent = screen.name || tr('circle.screens.untitled');
  nameBtn.addEventListener('click', () => onOpenScreen?.(screen.id));
  li.appendChild(nameBtn);

  // Circle-filter summary next to the name — gives the user a hint at
  // a glance: "all circles" vs "3 circles" vs "1 circle".
  const summary = document.createElement('span');
  summary.className = 'circle-screens-picker__summary';
  summary.textContent = circleFilterSummary(screen, tr);
  li.appendChild(summary);

  if (isActive) {
    const badge = document.createElement('span');
    badge.className = 'circle-screens-picker__active-badge';
    badge.textContent = tr('circle.screens.active');
    li.appendChild(badge);
  }

  const actions = document.createElement('div');
  actions.className = 'circle-screens-picker__actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'circle-screens-picker__rename';
  renameBtn.textContent = tr('circle.screens.rename');
  renameBtn.addEventListener('click', () => {
    const next = globalThis.prompt?.(tr('circle.screens.rename_prompt'), screen.name) ?? null;
    if (next == null) return;
    const trimmed = next.trim();
    if (trimmed && trimmed !== screen.name) onRenameScreen?.(screen.id, trimmed);
  });
  actions.appendChild(renameBtn);

  if (!isActive) {
    const activateBtn = document.createElement('button');
    activateBtn.type = 'button';
    activateBtn.className = 'circle-screens-picker__activate';
    activateBtn.textContent = tr('circle.screens.set_active');
    activateBtn.addEventListener('click', () => onSetActive?.(screen.id));
    actions.appendChild(activateBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'circle-screens-picker__remove';
  removeBtn.textContent = tr('circle.screens.delete');
  removeBtn.addEventListener('click', () => {
    if (!globalThis.confirm?.(tr('circle.screens.delete_confirm', { name: screen.name || '' }))) return;
    onRemoveScreen?.(screen.id);
  });
  actions.appendChild(removeBtn);

  li.appendChild(actions);
  return li;
}

function circleFilterSummary(screen, tr) {
  const f = screen?.circleFilter;
  if (f == null || (Array.isArray(f) && f.length === 0)) {
    return tr('circle.screens.filter_all');
  }
  if (f.length === 1) return tr('circle.screens.filter_one');
  return tr('circle.screens.filter_n', { count: f.length });
}
