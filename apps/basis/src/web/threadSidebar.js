/**
 * **Platform: web** (DOM-dependent).
 *
 * basis — thread sidebar DOM adapter.  Renders the workspace's
 * threads as a clickable list + new-thread form.  Pure DOM (no
 * framework); subscribes to ThreadStore changes for live updates.
 *
 * the state-machine pieces (form-state shape,
 * filter build, submit logic, parseList, KNOWN_EVENT_TYPES) lifted
 * to `src/core/threads/threadFormState.js` so basis-mobile's
 * RN renderer can reuse them.  This file keeps only DOM + event
 * wiring.
 *
 * Phase v0.2 per `/Project Files/basis/coding-plan.md`.
 */

import { describeFilter } from '../filter.js';
import {
  KNOWN_EVENT_TYPES,
  mergeKnownEventTypes,
  parseList,
  buildFilterFromFormState,
  emptyFormState,
  formStateFromThread,
  submitThreadForm,
} from '../core/threads/threadFormState.js';

/**
 * @typedef {object} SidebarContext
 * @property {Document}                                  doc
 * @property {import('../threadStore.js').ThreadStore}   store
 * @property {(threadId: string) => void}                onSelect
 *   Called when the user clicks a thread (request to set active).
 * @property {() => string[]}                            [knownApps]
 *   Returns the list of known app origins (from the catalogue).  Used
 *   to render clickable chip-suggestions in the new/edit thread form.
 * @property {() => string[]}                            [knownEventTypes]
 *   Returns common event types ('notification', 'item-changed', etc.)
 *   for the same chip-suggestion UX.
 * @property {(t: string) => string}                     [t]
 *   Optional localisation function.
 */

// KNOWN_EVENT_TYPES moved to src/core/threads/threadFormState.js
// . Re-imported here for the DOM renderer's use.

/**
 * Re-render the sidebar's thread list inside `container`.  Idempotent;
 * re-call on every ThreadStore change.
 *
 * @param {Element}         container
 * @param {SidebarContext}  ctx
 */
export function renderSidebar(container, ctx) {
  if (!container) throw new TypeError('renderSidebar: container required');
  const { doc, store, onSelect, t } = ctx;
  const tr = typeof t === 'function' ? t : (k) => k;

  while (container.firstChild) container.removeChild(container.firstChild);

  // Heading
  const heading = doc.createElement('h2');
  heading.className = 'cc-sidebar-heading';
  heading.textContent = tr('sidebar.heading');
  container.appendChild(heading);

  // + New thread button
  const newBtn = doc.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'cc-sidebar-new-thread';
  newBtn.textContent = tr('sidebar.new_thread');
  newBtn.addEventListener('click', () => toggleForm(container, ctx, null));
  container.appendChild(newBtn);

  // (form mounts under the button when toggled — for both create + edit)
  const formMount = doc.createElement('div');
  formMount.className = 'cc-sidebar-form-mount';
  container.appendChild(formMount);

  // Thread list
  const ul = doc.createElement('ul');
  ul.className = 'cc-thread-list';
  for (const thread of store.listThreads()) {
    ul.appendChild(renderThreadRow(thread, ctx, container));
  }
  container.appendChild(ul);
}

function renderThreadRow(thread, ctx, container) {
  const { doc, store, onSelect, t } = ctx;
  const tr = typeof t === 'function' ? t : (k) => k;
  const li = doc.createElement('li');
  const isActive = thread.id === store.activeId;
  li.className = `cc-thread-row${isActive ? ' cc-thread-active' : ''}`;
  li.dataset.threadId = thread.id;

  const nameBtn = doc.createElement('button');
  nameBtn.type = 'button';
  nameBtn.className = 'cc-thread-name';
  nameBtn.textContent = thread.name;
  nameBtn.addEventListener('click', () => onSelect(thread.id));
  li.appendChild(nameBtn);

  // Hide wildcard '*' filter labels — they're visual noise (every new
  // thread starts wildcard so they show as '*' under every row name).
  // Only render the filter label when it's a meaningful constraint.
  const filterText = describeFilter(thread.filter);
  if (filterText && filterText !== '*') {
    const filterLabel = doc.createElement('span');
    filterLabel.className = 'cc-thread-filter';
    filterLabel.textContent = filterText;
    li.appendChild(filterLabel);
  }

  // Edit affordance — opens the new-thread form pre-filled.
  const editBtn = doc.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'cc-thread-edit';
  editBtn.textContent = '✎';
  editBtn.title = tr('sidebar.edit');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleForm(container, ctx, thread);
  });
  li.appendChild(editBtn);

  // Delete button — disabled for the last remaining thread (UX guard).
  const delBtn = doc.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cc-thread-delete';
  delBtn.textContent = '×';
  delBtn.title = tr('sidebar.delete');
  delBtn.disabled = store.size <= 1;
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (store.size <= 1) return;
    store.deleteThread(thread.id);
  });
  li.appendChild(delBtn);

  return li;
}

/**
 * Toggle the create/edit form.  Passing `existingThread = null` opens
 * the create flow; passing a Thread instance opens the edit flow
 * pre-filled.  Clicking the same mode twice (or pressing Cancel)
 * closes the form.
 */
function toggleForm(container, ctx, existingThread) {
  const mount = container.querySelector('.cc-sidebar-form-mount');
  if (!mount) return;
  const desiredMode = existingThread ? `edit:${existingThread.id}` : 'create';
  if (mount.dataset.mode === desiredMode) {
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    delete mount.dataset.mode;
    return;
  }
  while (mount.firstChild) mount.removeChild(mount.firstChild);
  mount.dataset.mode = desiredMode;
  mount.appendChild(renderThreadForm(ctx, existingThread, () => {
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    delete mount.dataset.mode;
  }));
}

function renderThreadForm(ctx, existingThread, onDone) {
  const { doc, store, onSelect, t, knownApps, knownEventTypes } = ctx;
  const tr = typeof t === 'function' ? t : (k) => k;
  const editing = !!existingThread;

  const form = doc.createElement('form');
  form.className = 'cc-new-thread-form';

  // Selection state — Set-of-strings for apps + event-types.  When
  // empty the filter slot is omitted (= wildcard '*').  Custom
  // values typed in the "+ add custom" field land here too.
  // Form-state shape lifted to core.
  const state = editing
    ? formStateFromThread(existingThread)
    : emptyFormState();

  const appsList = (typeof knownApps  === 'function' ? knownApps()  : []) ?? [];
  const typesList = mergeKnownEventTypes(
    typeof knownEventTypes === 'function' ? knownEventTypes() : [],
  );

  // Title
  const heading = doc.createElement('div');
  heading.className = 'cc-form-heading';
  heading.textContent = editing ? tr('sidebar.form_edit_heading') : tr('sidebar.form_create_heading');
  form.appendChild(heading);

  // Name
  const nameLabel = doc.createElement('label');
  nameLabel.textContent = tr('sidebar.form_name');
  const nameInput = doc.createElement('input');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.className = 'cc-form-name';
  nameInput.value = state.name;
  nameInput.addEventListener('input', () => { state.name = nameInput.value; });
  nameLabel.appendChild(nameInput);
  form.appendChild(nameLabel);

  // Apps chip-toggle group
  form.appendChild(renderChipGroup({
    doc,
    label:       tr('sidebar.form_apps'),
    hint:        tr('sidebar.form_apps_hint'),
    knownValues: appsList,
    selected:    state.apps,
    onChange:    () => { /* selections mutate state.apps in place */ },
    addLabel:    tr('sidebar.form_add_custom_app'),
  }));

  // Event-types chip-toggle group
  form.appendChild(renderChipGroup({
    doc,
    label:       tr('sidebar.form_event_types'),
    hint:        tr('sidebar.form_event_types_hint'),
    knownValues: typesList,
    selected:    state.types,
    onChange:    () => {},
    addLabel:    tr('sidebar.form_add_custom_type'),
  }));

  // Actors (CSV — peer/actor ids are dynamic per-app, no fixed catalogue).
  const actorsLabel = doc.createElement('label');
  actorsLabel.textContent = tr('sidebar.form_peers');
  const actorsInput = doc.createElement('input');
  actorsInput.type = 'text';
  actorsInput.className = 'cc-form-peers';
  actorsInput.value = state.actors;
  actorsInput.placeholder = tr('sidebar.form_peers_placeholder');
  actorsInput.addEventListener('input', () => { state.actors = actorsInput.value; });
  actorsLabel.appendChild(actorsInput);
  const actorsHint = doc.createElement('div');
  actorsHint.className = 'cc-form-hint';
  actorsHint.textContent = tr('sidebar.form_peers_hint');
  actorsLabel.appendChild(actorsHint);
  form.appendChild(actorsLabel);

  // allowCommands toggle
  const cmdLabel = doc.createElement('label');
  cmdLabel.className = 'cc-form-checkbox';
  const cmdInput = doc.createElement('input');
  cmdInput.type = 'checkbox';
  cmdInput.checked = state.allowCommands;
  cmdInput.addEventListener('change', () => { state.allowCommands = cmdInput.checked; });
  cmdLabel.appendChild(cmdInput);
  cmdLabel.appendChild(doc.createTextNode(' ' + tr('sidebar.form_allow_commands')));
  form.appendChild(cmdLabel);

  // Buttons
  const actions = doc.createElement('div');
  actions.className = 'cc-form-actions';
  const submit = doc.createElement('button');
  submit.type = 'submit';
  submit.textContent = editing ? tr('sidebar.form_save') : tr('sidebar.form_create');
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.textContent = tr('sidebar.form_cancel');
  cancel.addEventListener('click', () => onDone());
  actions.appendChild(submit);
  actions.appendChild(cancel);
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Submit-side state machine lifted to core. Validation
    // (empty-name reject) + filter build + create-vs-update routing
    // all happen there; this handler just wires the DOM event +
    // the onSelect / onDone navigation.
    const result = submitThreadForm(state, store, { existingThread });
    if (!result.ok) return;        // e.g. 'name-required' — leave form open
    onSelect(result.threadId);
    onDone();
  });

  return form;
}

/**
 * Render a chip-toggle row.  Known values render as buttons that
 * toggle membership in `selected` on click.  An adjacent "+ custom"
 * input lets the user add a value not in the catalogue (which then
 * also renders as a chip).
 *
 * `selected` is a Set that mutates in place — callers read it on
 * submit, no callback wiring needed beyond the optional onChange
 * (kept for future-proofing).
 */
function renderChipGroup({ doc, label, hint, knownValues, selected, onChange, addLabel }) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-form-chip-group';

  const lab = doc.createElement('div');
  lab.className = 'cc-form-chip-label';
  lab.textContent = label;
  wrap.appendChild(lab);

  if (hint) {
    const h = doc.createElement('div');
    h.className = 'cc-form-hint';
    h.textContent = hint;
    wrap.appendChild(h);
  }

  const chipRow = doc.createElement('div');
  chipRow.className = 'cc-form-chip-row';
  wrap.appendChild(chipRow);

  // Union of known + already-selected (so editing a thread shows its
  // custom values as chips even when the catalogue doesn't list them).
  const all = [...new Set([...knownValues, ...selected])];

  const drawChip = (value) => {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = `cc-form-chip${selected.has(value) ? ' cc-form-chip-active' : ''}`;
    chip.textContent = value;
    chip.addEventListener('click', () => {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      chip.classList.toggle('cc-form-chip-active', selected.has(value));
      try { onChange?.(); } catch {}
    });
    return chip;
  };
  for (const v of all) chipRow.appendChild(drawChip(v));

  // + custom: append a new chip + auto-select it
  const addRow = doc.createElement('div');
  addRow.className = 'cc-form-chip-add';
  const addInput = doc.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = addLabel;
  addInput.className = 'cc-form-chip-add-input';
  const addBtn = doc.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addBtn.className = 'cc-form-chip-add-btn';
  const commit = () => {
    const v = addInput.value.trim();
    if (!v) return;
    if (!selected.has(v)) {
      selected.add(v);
      chipRow.appendChild(drawChip(v));
    }
    addInput.value = '';
    try { onChange?.(); } catch {}
  };
  addBtn.addEventListener('click', commit);
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);

  return wrap;
}

// parseList moved to src/core/threads/threadFormState.js.
