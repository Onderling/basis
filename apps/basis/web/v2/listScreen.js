/**
 * listScreen — B · web renderer for a manifest `surfaces.screen` list surface.
 *
 * `renderListScreen` is the CONTROLLED render over a screen MODEL (`buildScreenModel`): search box,
 * category checkboxes, and the filtered rows each with capability-gated action buttons (greyed/hidden
 * per). `renderListBlock` is the STATEFUL wrapper the live panel uses: it renders the chrome
 * (search + categories) ONCE and re-renders only the ROWS on filter — so the search box keeps focus —
 * while owning the query/activeCategories state. Pure DOM → unit-testable under happy-dom.
 */

import { buildScreenModel } from '../../src/v2/screenModel.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

/**
 * Render just the rows list (label + capability-gated action buttons); re-callable for partial updates.
 *
 * drill-down — when `onRowOpen` is provided the row LABEL renders as a
 * button: picking a row fires `onRowOpen({item, itemId})` (the host opens the
 * sibling DETAIL screen with the selection context — see shared
 * src/v2/screenDrilldown.js).  Without `onRowOpen` the label stays a plain
 * span (unchanged).
 */
export function renderListRows(listEl, { rows = [], t, onRowAction, onRowOpen } = {}) {
  const tr = translatorOr(t, 'listScreen.js');
  listEl.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'list-screen__empty';
    empty.textContent = tr('circle.screen.list_empty');
    listEl.appendChild(empty);
    return;
  }
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'list-screen__row';
    li.dataset.itemId = row.item?.id ?? '';

    let labelEl;
    if (typeof onRowOpen === 'function') {
      labelEl = document.createElement('button');
      labelEl.type = 'button';
      labelEl.className = 'list-screen__row-label list-screen__row-open';
      labelEl.addEventListener('click', () => onRowOpen({ item: row.item, itemId: row.item?.id }));
    } else {
      labelEl = document.createElement('span');
      labelEl.className = 'list-screen__row-label';
    }
    labelEl.textContent = row.label;
    li.appendChild(labelEl);

    for (const a of (row.actions || [])) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-screen__row-action';
      btn.textContent = a.label;
      btn.dataset.opId = a.opId;
      btn.dataset.itemId = a.itemId;
      if (a.disabled) { btn.disabled = true; btn.classList.add('list-screen__row-action--greyed'); }
      btn.addEventListener('click', () => { if (!a.disabled && typeof onRowAction === 'function') onRowAction({ opId: a.opId, itemId: a.itemId }); });
      li.appendChild(btn);
    }
    listEl.appendChild(li);
  }
}

/**
 * Option A — non-dismissible caption telling the user this list is
 * audience-scoped. Rendered under the title whenever the model carries an
 * `audienceScope` (the normalised audience `buildScreenModel` filtered by).
 * NON-dismissible on purpose: this is a visibility *scope*, not a user filter,
 * so there is no clear/close control. Generic text (no circle name) because the
 * pure model carries only the audience id. Shared helper → web≡mobile by
 * construction from the same model field.
 */
function audienceScopeCaption(container, { tr, audienceScope }) {
  if (audienceScope == null) return;
  const caption = document.createElement('p');
  caption.className = 'list-screen__scope-caption';
  caption.textContent = tr('circle.screen.audience_scope');
  container.appendChild(caption);
}

/** Build + append the search box (fires `onQuery` on input). */
function searchBox(container, { tr, query, onQuery }) {
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'list-screen__search';
  search.placeholder = tr('circle.screen.filter_placeholder');
  search.value = query;
  search.addEventListener('input', () => { if (typeof onQuery === 'function') onQuery(search.value); });
  container.appendChild(search);
  return search;
}

/** Build + append the category checkbox bar (fires `onToggle(id, checked)`). */
function categoryBar(container, { categories, onToggle }) {
  if (!categories.length) return;
  const bar = document.createElement('div');
  bar.className = 'list-screen__categories';
  for (const c of categories) {
    const label = document.createElement('label');
    label.className = 'list-screen__category';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!c.checked;
    box.dataset.category = c.id;
    box.addEventListener('change', () => { if (typeof onToggle === 'function') onToggle(c.id, box.checked); });
    const span = document.createElement('span');
    span.textContent = `${c.id} (${c.count})`;
    label.append(box, span);
    bar.appendChild(label);
  }
  container.appendChild(bar);
}

/** Controlled full render over a prebuilt model (used for tests + one-shot renders). */
export function renderListScreen(container, {
  model, t, title, query = '', onQuery, onToggleCategory, onRowAction, onRowOpen,
} = {}) {
  const tr = translatorOr(t, 'listScreen.js');
  container.innerHTML = '';
  container.classList.add('list-screen');
  if (title) {
    const h = document.createElement('h2');
    h.className = 'list-screen__title';
    h.textContent = title;
    container.appendChild(h);
  }
  audienceScopeCaption(container, { tr, audienceScope: model?.audienceScope });
  searchBox(container, { tr, query, onQuery });
  categoryBar(container, { categories: Array.isArray(model?.categories) ? model.categories : [], onToggle: onToggleCategory });
  const listEl = document.createElement('ul');
  listEl.className = 'list-screen__rows';
  renderListRows(listEl, { rows: Array.isArray(model?.rows) ? model.rows : [], t: tr, onRowAction, onRowOpen });
  container.appendChild(listEl);
  return container;
}

/**
 * The STATEFUL list block for the live panel. Renders the chrome (search + categories) once and
 * re-renders only the rows on filter (search box keeps focus). Owns query + activeCategories.
 *
 * @param {object} block  { items, categoryField?, labelField?, searchFields?, manifestsByOrigin?, appOrigin?, title? }
 */
export function renderListBlock(container, { block = {}, t, onRowAction, onRowOpen, capabilityMatrix = [] } = {}) {
  const tr = translatorOr(t, 'listScreen.js');
  container.innerHTML = '';
  container.classList.add('list-screen');
  let query = '';
  let activeCategories = null;   // null = all categories checked

  // D-mig-2 — `searchFields` (WHICH item fields the text search matches) is
  // sourced from the projected section, alongside labelField/categoryField.
  const shared = { items: block.items, categoryField: block.categoryField, labelField: block.labelField, searchFields: block.searchFields, defaultAudience: block.defaultAudience, manifestsByOrigin: block.manifestsByOrigin, appOrigin: block.appOrigin, capabilityMatrix };

  // Build the base model ONCE for the chrome: its categories seed the category
  // bar and its `audienceScope` drives the scope caption (both are
  // query/activeCategories-independent, so they don't change on filter).
  const baseModel = buildScreenModel(shared);

  if (block.title) {
    const h = document.createElement('h2');
    h.className = 'list-screen__title';
    h.textContent = block.title;
    container.appendChild(h);
  }
  audienceScopeCaption(container, { tr, audienceScope: baseModel.audienceScope });

  const rowsEl = document.createElement('ul');
  rowsEl.className = 'list-screen__rows';
  const renderRows = () => {
    const model = buildScreenModel({ ...shared, query, activeCategories });
    renderListRows(rowsEl, { rows: model.rows, t: tr, onRowAction, onRowOpen });
  };

  searchBox(container, { tr, query, onQuery: (q) => { query = q; renderRows(); } });

  // Categories built once from the full list; toggling updates activeCategories + re-renders rows only.
  const allCats = baseModel.categories;
  categoryBar(container, {
    categories: allCats,
    onToggle: (id, checked) => {
      const base = activeCategories == null ? allCats.map((c) => c.id) : activeCategories;
      const set = new Set(base);
      if (checked) set.add(id); else set.delete(id);
      activeCategories = [...set];
      renderRows();
    },
  });

  container.appendChild(rowsEl);
  renderRows();
  return container;
}
