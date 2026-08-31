/**
 * **Platform: web** (DOM-dependent).  Needs an RN sibling under `rn/` —
 * see `Project Files/basis/coding-plan.md` § RN portability inventory.
 *
 * basis — network-events log side-panel page (D.1, v0.7.1c).
 *
 * Renders an EventLog query result as a togglable side-panel with:
 *   - filter chips (app / type / actor / time-window / muted)
 *   - chronological event list (most-recent first)
 *   - per-event affordances: [View context] / [Mute kind] / [Open in chat]
 *
 * Same EventLog substrate (`src/eventLog.js`) powers this AND the
 * chat-inline `/logs` slash command — the user can use whichever
 * surface they prefer.  Mobile parity: the RN port consumes the
 * same EventLog + uses RN list components instead of DOM.
 *
 * Phase v0.7 per `/Project Files/basis/coding-plan.md`.
 */

import { renderFloatingButton } from '@onderling/chat-nav';

/**
 * @typedef {object} LogsPanelContext
 * @property {Document}                            doc
 * @property {import('../eventLog.js').EventLog}   eventLog
 * @property {() => void}                          onClose
 * @property {(itemRef: object) => void}           [onViewContext]
 * @property {(app: string, type: string) => void} [onMute]
 * @property {(event: object) => void}             [onOpenInChat]
 * @property {object}                              [backTo]
 *   chat-nav "← back to chat" affordance (E4).  When present, a
 *   floating button returns the user to the thread they opened the
 *   panel from — `onOpenInChat` may have switched the active thread,
 *   so [×] alone would not restore the origin focus.
 * @property {string}                              backTo.returnTo
 *   Origin thread id (required for the button to render).
 * @property {string}                              [backTo.label]
 * @property {() => void}                          [backTo.onNavigate]
 *   Refocus hook; the panel also calls `onClose` before this fires.
 */

const TIME_WINDOWS = [
  { id: 'all',       label: 'All' },
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Since yesterday' },
  { id: '7d',        label: 'Last 7 days' },
  { id: '14d',       label: 'Last 14 days' },
];

export function renderLogsPanel(container, ctx) {
  if (!container || !ctx?.doc || !ctx?.eventLog) {
    throw new TypeError('renderLogsPanel: container + ctx.doc + ctx.eventLog required');
  }
  // Stateful: filter selection lives on the container's dataset
  // for re-render simplicity.  No external state to wire.
  const state = {
    filterApp:    container.dataset.filterApp    ?? '',
    filterType:   container.dataset.filterType   ?? '',
    filterActor:  container.dataset.filterActor  ?? '',
    timeWindow:   container.dataset.timeWindow   ?? 'all',
    showMuted:    container.dataset.showMuted === '1',
  };
  function persist() {
    container.dataset.filterApp   = state.filterApp;
    container.dataset.filterType  = state.filterType;
    container.dataset.filterActor = state.filterActor;
    container.dataset.timeWindow  = state.timeWindow;
    container.dataset.showMuted   = state.showMuted ? '1' : '0';
  }
  function rerender() { persist(); paint(container, ctx, state, rerender); }
  rerender();
}

function paint(container, ctx, state, rerender) {
  const { doc, eventLog, onClose, onViewContext, onMute, onOpenInChat } = ctx;
  const tt = (k, fb) => (ctx.t ? ctx.t(k) : fb);
  while (container.firstChild) container.removeChild(container.firstChild);

  /* ── header ── */
  const header = doc.createElement('div');
  header.className = 'cc-logs-header';
  const title = doc.createElement('h2');
  title.className = 'cc-logs-title';
  title.textContent = tt('logs.network_events', 'Network events');
  header.appendChild(title);
  if (typeof onClose === 'function') {
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-panel-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => onClose());
    header.appendChild(closeBtn);
  }
  container.appendChild(header);

  /* ── filter chips ── */
  const chips = doc.createElement('div');
  chips.className = 'cc-logs-chips';

  // Each filter is an editable chip with a clear-X.
  appendChipInput(chips, doc, 'App',   state.filterApp,   'household / tasks-v0 / stoop / folio',
    (v) => { state.filterApp = v; rerender(); });
  appendChipInput(chips, doc, 'Type',  state.filterType,  'item-changed / notification',
    (v) => { state.filterType = v; rerender(); });
  appendChipInput(chips, doc, 'Actor', state.filterActor, 'webid:anne',
    (v) => { state.filterActor = v; rerender(); });

  // Time window — select chip.
  const timeChip = doc.createElement('label');
  timeChip.className = 'cc-logs-chip cc-logs-time';
  const timeLabel = doc.createElement('span');
  timeLabel.className = 'cc-logs-chip-label';
  timeLabel.textContent = 'When:';
  timeChip.appendChild(timeLabel);
  const sel = doc.createElement('select');
  sel.className = 'cc-logs-chip-select';
  for (const w of TIME_WINDOWS) {
    const opt = doc.createElement('option');
    opt.value = w.id; opt.textContent = w.label;
    if (state.timeWindow === w.id) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', (e) => {
    state.timeWindow = e.target.value;
    rerender();
  });
  timeChip.appendChild(sel);
  chips.appendChild(timeChip);

  // Show-muted toggle.
  const mutedChip = doc.createElement('label');
  mutedChip.className = 'cc-logs-chip cc-logs-show-muted';
  const cb = doc.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.showMuted;
  cb.addEventListener('change', () => { state.showMuted = cb.checked; rerender(); });
  mutedChip.appendChild(cb);
  const cbLabel = doc.createElement('span');
  cbLabel.textContent = tt('logs.show_muted', 'Show muted');
  mutedChip.appendChild(cbLabel);
  chips.appendChild(mutedChip);

  container.appendChild(chips);

  /* ── event list ── */
  const filter = {};
  if (state.filterApp)    filter.apps       = state.filterApp  .split(/\s+/).filter(Boolean);
  if (state.filterType)   filter.eventTypes = state.filterType .split(/\s+/).filter(Boolean);
  if (state.filterActor)  filter.actors     = state.filterActor.split(/\s+/).filter(Boolean);

  const since = timeWindowSince(state.timeWindow);
  const events = eventLog.query({
    filter:        Object.keys(filter).length > 0 ? filter : undefined,
    since,
    excludeMuted:  !state.showMuted,
    limit:         200,
  });

  const list = doc.createElement('div');
  list.className = 'cc-logs-list';
  if (events.length === 0) {
    const empty = doc.createElement('div');
    empty.className = 'cc-logs-empty';
    empty.textContent = tt('logs.no_match', 'No events match the current filters.');
    list.appendChild(empty);
  } else {
    for (const e of events) list.appendChild(renderEventRow(e, doc, eventLog, { onViewContext, onMute, onOpenInChat, rerender, t: ctx.t }));
  }
  container.appendChild(list);

  /* ── footer counter ── */
  const footer = doc.createElement('div');
  footer.className = 'cc-logs-footer';
  footer.textContent = `${events.length} event${events.length === 1 ? '' : 's'}  ·  log holds ${eventLog.size} (14-day retention)`;
  container.appendChild(footer);

  /* ── back-to-chat (E4, chat-nav) — returns to the origin thread ── */
  const backTo = ctx.backTo;
  if (backTo?.returnTo) {
    renderFloatingButton(container, {
      doc,
      returnTo:   backTo.returnTo,
      label:      backTo.label,
      onNavigate: () => {
        if (typeof onClose === 'function') onClose();
        if (typeof backTo.onNavigate === 'function') backTo.onNavigate();
      },
    });
  }
}

function renderEventRow(event, doc, eventLog, ctx) {
  const tt = (k, fb) => (ctx.t ? ctx.t(k) : fb);
  const row = doc.createElement('div');
  row.className = 'cc-logs-row';
  if (eventLog.isMuted(event.app, event.type)) row.classList.add('cc-logs-row-muted');

  const meta = doc.createElement('div');
  meta.className = 'cc-logs-row-meta';
  const time = new Date(event.ts);
  const date = `${time.getUTCMonth() + 1}/${time.getUTCDate()}`;
  const clock = `${String(time.getUTCHours()).padStart(2, '0')}:${String(time.getUTCMinutes()).padStart(2, '0')}`;
  meta.innerHTML = `<span class="cc-logs-row-time">${date} ${clock}</span> ` +
                   `<span class="cc-logs-row-app">${escapeHtml(event.app)}</span>` +
                   `<span class="cc-logs-row-type">${escapeHtml(event.type)}</span>` +
                   (event.actor ? `<span class="cc-logs-row-actor">${escapeHtml(event.actor)}</span>` : '');
  row.appendChild(meta);

  const body = doc.createElement('div');
  body.className = 'cc-logs-row-body';
  body.textContent = event.payload?.message ?? event.payload?.text ?? `[${event.app}/${event.type}]`;
  row.appendChild(body);

  const actions = doc.createElement('div');
  actions.className = 'cc-logs-row-actions';

  if (event.itemRef && typeof ctx.onViewContext === 'function') {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-logs-row-action';
    btn.textContent = tt('logs.view_context', 'View context');
    btn.addEventListener('click', () => ctx.onViewContext(event.itemRef));
    actions.appendChild(btn);
  }
  if (typeof ctx.onMute === 'function') {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-logs-row-action';
    btn.textContent = eventLog.isMuted(event.app, event.type) ? 'Unmute kind' : 'Mute kind';
    btn.addEventListener('click', () => {
      if (eventLog.isMuted(event.app, event.type)) eventLog.unmute(event.app, event.type);
      else                                          eventLog.mute(event.app, event.type);
      ctx.rerender();
    });
    actions.appendChild(btn);
  }
  if (typeof ctx.onOpenInChat === 'function') {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-logs-row-action';
    btn.textContent = tt('logs.open_in_chat', 'Open in chat');
    btn.addEventListener('click', () => ctx.onOpenInChat(event));
    actions.appendChild(btn);
  }
  if (actions.childNodes.length > 0) row.appendChild(actions);
  return row;
}

function appendChipInput(chips, doc, label, value, placeholder, onChange) {
  const chip = doc.createElement('label');
  chip.className = 'cc-logs-chip';
  const span = doc.createElement('span');
  span.className = 'cc-logs-chip-label';
  span.textContent = `${label}:`;
  chip.appendChild(span);
  const inp = doc.createElement('input');
  inp.type = 'text';
  inp.value = value;
  inp.placeholder = placeholder;
  inp.className = 'cc-logs-chip-input';
  inp.addEventListener('change', () => onChange(inp.value));
  chip.appendChild(inp);
  if (value) {
    const x = doc.createElement('button');
    x.type = 'button';
    x.className = 'cc-logs-chip-clear';
    x.textContent = '×';
    x.addEventListener('click', () => onChange(''));
    chip.appendChild(x);
  }
  chips.appendChild(chip);
}

function timeWindowSince(id) {
  const now = Date.now();
  if (id === 'today') {
    const d = new Date(); d.setHours(0,0,0,0); return d.getTime();
  }
  if (id === 'yesterday') {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - 1); return d.getTime();
  }
  if (id === '7d')  return now - 7  * 86_400_000;
  if (id === '14d') return now - 14 * 86_400_000;
  return undefined;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
