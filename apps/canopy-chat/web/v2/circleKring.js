/**
 * canopy-chat v2 — kring content view (web DOM renderer, SP-13.2 / v2 §1+§5).
 *
 * The screen you land on after tapping a kring tile.  Chat-style mixed
 * message stream + inline composer.  No separate chat shell exists; chat
 * IS the kring view.
 *
 * Renders per v2 §1 board "VOORBEELD 1 · BUURT":
 *
 *   [← back]  Kring name  [⋯ more]
 *             N LEDEN · functies meta
 *   ─ dated divider ─
 *   ┌─ bubble (sender)
 *   │  text
 *   │  [Ik help] [Negeer]   (per-row action chips)
 *   └─
 *   ┌─ PRIKBORD card
 *   │  "3 nieuwe vragen vandaag."
 *   └─
 *   ┌─ AANKONDIGING card
 *   │  "Buurtborrel zaterdag 17u"
 *   └─
 *   …
 *   [+] [Schrijf naar de buurt…       ] [↑]
 *
 * Pure render: the host wires:
 *   - `rows`          buildKringStream output (already scoped to this kring)
 *   - `onSend(text)`  composer submit handler
 *   - `onAction(action, row)`  per-row action chip taps
 *   - `onBack`        back-to-launcher
 *   - `more`          overflow-menu callbacks (settings / mine / files / …)
 *   - `composerPlaceholder`  kring-specific placeholder text (optional)
 *
 * Per-kring bottom tabs (GESPREK / PRIKBORD / LEDEN etc.) live in
 * SP-13.3; this slice focuses on the GESPREK render.
 */

import { actionsForStreamRow } from '../../src/v2/streamActions.js';
import { renderCircleScreen } from './circleScreen.js';
import { suggestCommands } from '../../src/v2/commandSuggest.js';

export function renderCircleKring(container, {
  circle = {},
  rows = [],
  onBack,
  onSend,
  onAction,
  more = null,
  composerPlaceholder = null,
  // SP-13.3 — per-kring bottom tabs (board Voorbeeld 1-3).
  // `tabs`     `[{id, label}]` produced by `buildKringTabs(policy, t)`
  // `activeTab` current tab id (defaults to first / 'gesprek')
  // `onTab(id)` host switches its content render when a tab is tapped
  tabs = null,
  activeTab = null,
  onTab,
  // SP-13.4 — Chat ↔ Scherm header pill (v2 §4 board "De Schakelaar").
  // `viewMode`   one of 'chat' | 'scherm' (default 'chat')
  // `onViewMode(mode)`  host flips between the chat-style stream and
  //   the admin-recept'd scherm-weergave.
  viewMode = 'chat',
  onViewMode,
  // α.1c — materialized scherm blocks (kringRecipeBlocks.materializeRecipe).
  // null = host hasn't loaded yet (show empty-state placeholder);
  // [] = book is empty; [...] = render each block via circleScreen.
  screenBlocks = null,
  // D1 (§5A) — quickActions pill tap → host routes the feature key to a
  // kring tab / action.  Forwarded to renderCircleScreen's onAction.
  onScreenAction = null,
  // δ.2 — optimistic-send delivery state hook.
  //   `deliveryStateFor(msgId)` returns 'pending' | 'sent' | 'failed' | null
  //   `localActor`              actor stamp for locally-sent messages — only
  //                             these get a delivery icon
  //   `onRetryDelivery(msgId)`  tap-to-retry callback for 'failed' icons
  // All three are optional; when missing the bubbles render exactly as before.
  deliveryStateFor = null,
  localActor = null,
  onRetryDelivery = null,
  // Composer affordances (web↔mobile parity, ported from the classic shell). Both optional — without
  // them the composer renders exactly as before.
  //   `catalog`  the merged dispatch catalog → drives the slash-command auto-suggest dropdown.
  //   `history`  a `createInputHistory()` instance (host-owned so it survives re-renders) → ArrowUp/Down.
  catalog = null,
  history = null,
  t,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-kring');

  // Header — back · title · more.
  const header = document.createElement('div');
  header.className = 'circle-kring__header';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-kring__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  header.appendChild(back);

  const title = document.createElement('h2');
  title.className = 'circle-kring__title';
  title.textContent = circle.name || circle.id || '';
  header.appendChild(title);

  // SP-13.4 — Chat ↔ Scherm pill (v2 §4 board "De Schakelaar").
  // Only renders when the host wires `onViewMode`; otherwise the
  // header stays clean (some hosts may want to suppress it).
  if (typeof onViewMode === 'function') {
    const toggle = document.createElement('div');
    toggle.className = 'circle-kring__view-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', tr('circle.kring.view_toggle_label'));
    for (const mode of ['chat', 'scherm']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__view-toggle-btn';
      btn.dataset.viewMode = mode;
      if (mode === viewMode) btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', mode === viewMode ? 'true' : 'false');
      btn.textContent = tr(`circle.kring.view_${mode}`);
      btn.addEventListener('click', () => {
        if (mode !== viewMode) onViewMode(mode);
      });
      toggle.appendChild(btn);
    }
    header.appendChild(toggle);
  }

  const moreActions = collectMoreActions(more, tr);
  if (moreActions.length > 0) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'circle-kring__more';
    moreBtn.setAttribute('aria-label', tr('circle.kring.more'));
    moreBtn.textContent = '⋯';
    moreBtn.addEventListener('click', () => {
      const menu = container.querySelector('.circle-kring__more-menu');
      if (menu) menu.classList.toggle('is-open');
    });
    header.appendChild(moreBtn);
  }
  container.appendChild(header);

  if (circle.memberCount != null) {
    const meta = document.createElement('div');
    meta.className = 'circle-kring__meta';
    meta.textContent = tr('circle.members', { count: circle.memberCount });
    container.appendChild(meta);
  }

  if (moreActions.length > 0) {
    const menu = document.createElement('div');
    menu.className = 'circle-kring__more-menu';
    for (const a of moreActions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'circle-kring__more-item';
      item.dataset.action = a.id;
      item.textContent = a.label;
      item.addEventListener('click', () => {
        menu.classList.remove('is-open');
        a.run();
      });
      menu.appendChild(item);
    }
    container.appendChild(menu);
  }

  // SP-13.3 — body switches by active tab.  GESPREK = the chat-style
  // bubble stream + day-dividers; all other tabs are placeholders for
  // now (per-tab content lands in SP-13.3-followups).  Composer stays
  // pinned at the bottom regardless — per v2 §1 all 3 voorbeeld boards
  // show the composer present whatever the body is.
  // `??` would treat the `Array.isArray && tabs[0]?.id` short-circuit's
  // false as non-nullish; fall back through plain `||` instead so the
  // no-tabs case ends up on 'gesprek' (the GESPREK render path).
  const firstTabId = Array.isArray(tabs) && tabs.length > 0 ? tabs[0].id : null;
  const effectiveTab = activeTab || firstTabId || 'gesprek';
  const body = document.createElement('div');
  body.className = 'circle-kring__list';
  body.dataset.activeTab = effectiveTab;
  body.dataset.viewMode  = viewMode;
  if (viewMode === 'scherm') {
    // α.1c — render the materialized recipe blocks.  `screenBlocks`
    // is an array from kringRecipeBlocks.materializeRecipe; null
    // means "host hasn't loaded yet" — show the empty-state for
    // a clean first paint.  circleScreen handles per-block status
    // (ok / empty / error) internally.
    renderCircleScreen(body, { blocks: screenBlocks ?? [], t: tr, onAction: onScreenAction });
  } else if (effectiveTab !== 'gesprek') {
    const placeholder = document.createElement('div');
    placeholder.className = 'circle-kring__placeholder';
    placeholder.textContent = tr('circle.kring.tab_coming', {
      tab: tr(`circle.tabs.${effectiveTab}`),
    });
    body.appendChild(placeholder);
  } else if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-kring__empty';
    empty.textContent = tr('circle.kring.empty');
    body.appendChild(empty);
  } else {
    // Render chronologically (oldest at top), grouped by day.  rows from
    // buildKringStream are newest-first; reverse a copy so the timeline
    // reads top → bottom like a chat.
    const chronological = [...rows].reverse();
    let lastDayKey = null;
    for (const row of chronological) {
      const dayKey = dayKeyOf(row.ts);
      if (dayKey !== lastDayKey) {
        body.appendChild(renderDayDivider(row.ts, tr));
        lastDayKey = dayKey;
      }
      body.appendChild(renderBubble(row, {
        tr, onAction,
        deliveryStateFor, localActor, onRetryDelivery,
      }));
    }
  }
  container.appendChild(body);

  // Composer — text input + send button.  Suppressed in scherm-mode
  // because the recept'd page isn't a chat surface; user flips back
  // to Chat to write something.
  if (typeof onSend === 'function' && viewMode !== 'scherm') {
    const form = document.createElement('form');
    form.className = 'circle-kring__composer';
    form.setAttribute('autocomplete', 'off');

    // Slash-command auto-suggest dropdown (rendered first, positioned ABOVE the input via CSS). Hidden
    // until the user types a "/command" word; populated from the injected catalog. Mirrors the classic
    // shell (#cmd-suggest); behaviour ported into the shared `suggestCommands`.
    const suggestEl = document.createElement('ul');
    suggestEl.className = 'circle-kring__suggest';
    suggestEl.setAttribute('role', 'listbox');
    suggestEl.hidden = true;
    form.appendChild(suggestEl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'circle-kring__composer-input';
    input.placeholder = composerPlaceholder ?? tr('circle.kring.composer_placeholder');
    input.setAttribute('aria-label', tr('circle.kring.composer_placeholder'));
    form.appendChild(input);

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'circle-kring__composer-send';
    send.setAttribute('aria-label', tr('circle.kring.send'));
    send.textContent = '↑';
    form.appendChild(send);

    // ── suggest state (local to this render; `history` is host-owned + persists across re-renders) ──
    let entries = [];
    let activeIdx = -1;

    const paintSuggest = (matches) => {
      suggestEl.innerHTML = '';
      entries = matches;
      if (!matches.length) { suggestEl.hidden = true; activeIdx = -1; return; }
      if (activeIdx < 0 || activeIdx >= matches.length) activeIdx = 0;
      matches.forEach((m, i) => {
        const li = document.createElement('li');
        li.className = `circle-kring__suggest-item${i === activeIdx ? ' is-active' : ''}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
        const cmd = document.createElement('span');
        cmd.className = 'circle-kring__suggest-cmd';
        cmd.textContent = m.command;
        li.appendChild(cmd);
        if (m.hint) {
          const hint = document.createElement('span');
          hint.className = 'circle-kring__suggest-hint';
          hint.textContent = m.hint;
          li.appendChild(hint);
        }
        // mousedown (not click) so it fires before the input's blur closes the list.
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); acceptSuggest(i); });
        suggestEl.appendChild(li);
      });
      suggestEl.hidden = false;
    };
    const refreshSuggest = () => paintSuggest(catalog ? suggestCommands(catalog, input.value) : []);
    const acceptSuggest = (i) => {
      const m = entries[i];
      if (!m) return;
      input.value = `${m.command} `;          // full command + trailing space → keep typing args
      paintSuggest([]);
      input.focus();
    };

    if (catalog) {
      input.addEventListener('input', () => { if (history) history.reset(); refreshSuggest(); });
      input.addEventListener('focus', refreshSuggest);
      // Defer so a click/mousedown on a suggestion item fires before the list closes.
      input.addEventListener('blur', () => setTimeout(() => paintSuggest([]), 120));
    }

    input.addEventListener('keydown', (e) => {
      const open = catalog && !suggestEl.hidden && entries.length > 0;
      if (open) {
        // Dropdown navigation takes the arrow/Tab/Enter/Escape keys (classic parity).
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % entries.length; paintSuggest(entries); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx - 1 + entries.length) % entries.length; paintSuggest(entries); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && activeIdx >= 0)) { e.preventDefault(); acceptSuggest(activeIdx); return; }
        if (e.key === 'Escape')    { e.preventDefault(); paintSuggest([]); return; }
      }
      // Bash-style history navigation — only when the dropdown is closed.
      if (history && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (e.key === 'ArrowUp') {
          const v = history.prev(input.value);
          if (v != null) { e.preventDefault(); input.value = v; setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0); }
        } else {
          const v = history.next();
          if (v != null) { e.preventDefault(); input.value = v; }
        }
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (history) history.push(text);
      onSend(text);
      input.value = '';
      paintSuggest([]);
      // Keep focus so a quick burst of messages feels native.
      input.focus();
    });
    container.appendChild(form);
  }

  // SP-13.3 — per-kring bottom tab bar.  Only renders when a tabs
  // list with ≥ 2 entries is supplied (a single-tab kring has no
  // bar to switch on).  The launcher's global Kringen/Stroom/Mij
  // bar sits in a different DOM root, so the two never collide.
  // SP-13.4 — also suppress in scherm-mode (scherm is one canonical
  // page, no sub-tabs).
  if (Array.isArray(tabs) && tabs.length >= 2 && viewMode !== 'scherm') {
    const bar = document.createElement('nav');
    bar.className = 'circle-kring__tabs';
    bar.setAttribute('aria-label', tr('circle.kring.tabs_label'));
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__tab';
      btn.dataset.tab = tab.id;
      if (tab.id === effectiveTab) btn.classList.add('is-active');
      btn.textContent = tab.label ?? tr(tab.labelKey);
      btn.addEventListener('click', () => {
        if (typeof onTab === 'function' && tab.id !== effectiveTab) onTab(tab.id);
      });
      bar.appendChild(btn);
    }
    container.appendChild(bar);
  }

  return container;
}

/* ──────────────────────────────────────────────────────────────────
 * Internals
 * ────────────────────────────────────────────────────────────────── */

function renderBubble(row, {
  tr, onAction,
  // δ.2 — delivery-icon plumbing; all three are optional.
  deliveryStateFor = null, localActor = null, onRetryDelivery = null,
} = {}) {
  const el = document.createElement('div');
  el.className = 'circle-kring__bubble';
  el.dataset.rowId = row.id ?? '';

  // Sender label (top-left, small).
  const senderText = pickSender(row);
  if (senderText) {
    const sender = document.createElement('div');
    sender.className = 'circle-kring__bubble-sender';
    sender.textContent = senderText;
    el.appendChild(sender);
  }

  // Kind pill (small, inline before text — matches the v2 PRIKBORD card
  // shape).  For chat-only messages the kind is null and no pill renders.
  const kind = pickKindLabel(row);
  if (kind) {
    const tag = document.createElement('span');
    tag.className = 'circle-kring__bubble-kind';
    tag.textContent = kind;
    el.appendChild(tag);
  }

  const text = document.createElement('div');
  text.className = 'circle-kring__bubble-text';
  text.textContent = pickRowText(row) ?? tr(`circle.streamAction.${row.type ?? 'unknown'}`) ?? '';
  el.appendChild(text);

  // Per-row action chips (Ik help / Negeer / Ik doe ze …).  Substrate
  // already picks the right set per row kind.
  const actions = actionsForStreamRow(row);
  if (actions.length) {
    const actRow = document.createElement('div');
    actRow.className = 'circle-kring__bubble-actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__bubble-action';
      btn.dataset.action = a.action;
      btn.textContent = tr(a.label);
      btn.addEventListener('click', () => {
        if (typeof onAction === 'function') onAction(a, row);
      });
      actRow.appendChild(btn);
    }
    el.appendChild(actRow);
  }

  // δ.2 — delivery-state icon for locally-sent chat messages.  Only
  // surfaces when (a) the host supplied a lookup, (b) the row's actor
  // matches the local actor stamp, and (c) the bubble is a chat-message
  // (other row kinds — buurt-post mirrors etc. — never have delivery
  // state).  The happy path ('sent' / null) renders nothing so it
  // doesn't clutter the timeline.
  if (
    typeof deliveryStateFor === 'function'
    && localActor != null
    && row?.actor === localActor
    && (row?.type === 'chat-message' || row?.event?.type === 'chat-message')
  ) {
    const state = deliveryStateFor(row.id);
    if (state === 'pending') {
      const ic = document.createElement('span');
      ic.className = 'circle-kring__bubble-delivery circle-kring__bubble-delivery--pending';
      ic.dataset.deliveryState = 'pending';
      ic.setAttribute('role', 'status');
      ic.setAttribute('aria-label', tr('circle.chat.delivery.pending'));
      ic.title = tr('circle.chat.delivery.pending');
      ic.textContent = '⏱';
      el.appendChild(ic);
    } else if (state === 'failed') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-kring__bubble-delivery circle-kring__bubble-delivery--failed';
      btn.dataset.deliveryState = 'failed';
      btn.setAttribute('aria-label', tr('circle.chat.delivery.failed'));
      btn.title = tr('circle.chat.delivery.failed');
      btn.textContent = '⚠';
      btn.addEventListener('click', () => {
        if (typeof onRetryDelivery === 'function') onRetryDelivery(row.id);
      });
      el.appendChild(btn);
    }
    // 'sent' (and null) intentionally render nothing — happy path.
  }

  return el;
}

function renderDayDivider(ts, tr) {
  const el = document.createElement('div');
  el.className = 'circle-kring__day';
  el.textContent = formatDayLabel(ts, tr);
  return el;
}

function dayKeyOf(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown';
  const d = new Date(ts);
  // YYYY-MM-DD — local-time day key (avoid UTC drift across timezones).
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDayLabel(ts, tr) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (sameDay)     return tr('circle.kring.day_today');
  if (isYesterday) return tr('circle.kring.day_yesterday');
  return d.toLocaleDateString();
}

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name', 'message']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return null;
}

function pickKindLabel(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  const k = typeof p.kind === 'string' && p.kind ? p.kind : null;
  // Don't show a kind pill for plain chat messages — they're the default.
  if (!k || k === 'message' || k === 'chat-message') return null;
  return k.toUpperCase();
}

function pickSender(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['senderDisplay', 'authorName', 'displayName', 'actor']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  if (typeof row?.actor === 'string' && row.actor) return row.actor;
  return null;
}

const MORE_ITEMS = [
  { key: 'settings', labelKey: 'circle.settings.title' },
  { key: 'mine',     labelKey: 'circle.override.title' },
  { key: 'viewAs',   labelKey: 'circle.viewAs.title' },
  { key: 'advisor',  labelKey: 'circle.advisor.title' },
  { key: 'skills',   labelKey: 'circle.skills.editor_title' },
  { key: 'files',    labelKey: 'circle.folio.title' },
  { key: 'rules',    labelKey: 'circle.rules.title' },
  // α.1d — edit per-kring scherm recipes (multiple, one marked active).
  { key: 'recipes',  labelKey: 'circle.recipe.editor.book_title' },
];

function collectMoreActions(more, tr) {
  if (!more || typeof more !== 'object') return [];
  const out = [];
  for (const item of MORE_ITEMS) {
    const fn = more[item.key];
    if (typeof fn === 'function') {
      out.push({ id: item.key, label: tr(item.labelKey), run: fn });
    }
  }
  return out;
}
