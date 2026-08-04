/**
 * basis v2 — screen renderer (Plan α.1c.1 · audit gap #1).
 *
 * Consumes materialized blocks from `kringRecipeBlocks.js` and produces
 * the DOM for scherm-mode (v2 §4 pill, §2 RECEPT · SCHERM-WEERGAVE
 * INRICHTEN).
 *
 * Pure DOM render (web).  Mobile parity ships as α.1e using the same
 * materialized-block input.
 *
 * Per-block-type render:
 *   quickActions → "Veel-gebruikt" pill row (D1 §5A) — top-N actions
 *   announcement → serif headline card (pinned admin message)
 *   text         → plain-text paragraph card
 *   photo        → image with optional caption
 *   noticeboard  → list of recent posts (sender · text)
 *   agenda       → list of upcoming events (label · state)
 *   rules        → rendered governance doc (per-field section)
 *
 * Each block also surfaces its status:
 *   ok      → normal render
 *   empty   → muted placeholder ("nothing here yet")
 *   error   → red border + error message (per-block, page keeps rendering)
 */

import { featureActionLabelKey } from '../../src/v2/kringTabs.js';
import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../src/v2/embedChips.js';

/**
 * Render an array of materialized blocks into a container.
 *
 * @param {HTMLElement} container
 * @param {object}    args
 * @param {object[]}  args.blocks       materializeRecipe(...) output
 * @param {Function}  args.t            localizer
 * @param {boolean}   [args.refreshing] δ.1 — when true and `blocks` is a
 *        non-empty array, append a subtle pip element to signal a
 *        background materialize is in flight (cache-first render).
 *        Ignored on the loading / empty branches.
 * @param {(actionKey: string) => void} [args.onAction] invoked when a
 *        quickActions pill is tapped (host routes the feature to a tab /
 *        action).  Omitted → pills render disabled.
 * @returns {HTMLElement}
 */
export function renderCircleScreen(container, { blocks = [], t, refreshing = false, onAction, onEmbedOpen, highlightRef } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-screen');

  // null/undefined = still materializing.  Distinguish from `[]` so the
  // wait shows "Loading…" instead of the "admin hasn't set up" empty
  // state (visually identical, made the wait feel broken).
  if (blocks === null || blocks === undefined) {
    const loading = document.createElement('div');
    loading.className = 'circle-screen__loading';
    loading.textContent = tr('circle.screen.loading');
    container.appendChild(loading);
    return container;
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'circle-screen__empty';
    empty.textContent = tr('circle.screen.empty');
    container.appendChild(empty);
    return container;
  }

  for (const block of blocks) {
    container.appendChild(renderBlock(block, { tr, onAction, onEmbedOpen, highlightRef }));
  }
  // δ.1 — subtle refresh pip when rendering cached blocks while a fresh
  // materialize is in flight.  Static glyph (⟳) is enough; no animation
  // needed.  Tooltip = "Refreshing…" so hover gives the full word.
  if (refreshing === true) {
    const pip = document.createElement('span');
    pip.className = 'circle-screen__refreshing';
    pip.textContent = '⟳';
    pip.title = tr('circle.screen.refreshing');
    pip.setAttribute('aria-label', tr('circle.screen.refreshing'));
    container.appendChild(pip);
  }
  return container;
}

/* ─────────────────────────────────────────────────────────────────────── */

// α.5c — list-shaped block types that honour the optional
// `config.compact` flag (tighter rows + smaller text on the screen).
const COMPACTABLE_TYPES = new Set(['announcement', 'noticeboard', 'agenda', 'tasks']);

// An embed `ref` may be a full URN (urn:dec:item:T2) while a rendered row
// carries only the local id (T2).  Match the raw ref OR its local-id tail so a
// chip tap can find its row regardless of which form each side holds.
function matchesHighlight(rowId, highlightRef) {
  if (!rowId || !highlightRef) return false;
  return rowId === highlightRef || String(highlightRef).endsWith(String(rowId));
}

// Scroll a freshly-highlighted row into view.  Guarded: happy-dom / older
// browsers may not implement scrollIntoView, and the test DOM has no layout.
function scrollRowIntoView(el) {
  if (el && typeof el.scrollIntoView === 'function') {
    try { el.scrollIntoView({ block: 'center' }); } catch { /* layout-less DOM */ }
  }
}

function renderBlock(block, { tr, onAction, onEmbedOpen, highlightRef }) {
  const section = document.createElement('section');
  section.className = `circle-screen__block circle-screen__block--${block.type}`;
  if (COMPACTABLE_TYPES.has(block.type) && block.config?.compact === true) {
    section.classList.add('circle-screen__block--compact');
  }
  section.dataset.blockId = block.blockId ?? '';
  section.dataset.blockType = block.type;
  section.dataset.status = block.status;

  if (block.status === 'error') {
    section.classList.add('circle-screen__block--error');
    section.textContent = tr('circle.screen.block_error', { type: block.type })
      + (block.error ? ` — ${block.error}` : '');
    return section;
  }
  if (block.status === 'empty') {
    section.classList.add('circle-screen__block--empty');
    section.textContent = tr('circle.screen.block_empty', { type: block.type });
    return section;
  }

  switch (block.type) {
    case 'quickActions': renderQuickActions(section, block, tr, onAction); break;
    case 'announcement': renderAnnouncement(section, block, tr); break;
    case 'text':         renderText(section, block, tr);         break;
    case 'photo':        renderPhoto(section, block, tr);        break;
    case 'noticeboard':  renderNoticeboard(section, block, tr);  break;
    case 'agenda':       renderAgenda(section, block, tr, highlightRef);       break;
    case 'tasks':        renderTasks(section, block, tr, onEmbedOpen, highlightRef); break;
    case 'rules':        renderRules(section, block, tr);        break;
    default:
      section.textContent = tr('circle.screen.block_unknown', { type: block.type });
  }
  return section;
}

// D1 (§5A) — "Veel-gebruikt" pill row.  Each action is a feature key;
// the label comes from the shared feature→label map, and a tap calls
// `onAction(key)` so the host can switch to that feature's tab / surface.
function renderQuickActions(section, block, tr, onAction) {
  const row = document.createElement('div');
  row.className = 'circle-screen__quick-actions';
  for (const action of block.content?.actions ?? []) {
    const key = action?.key;
    if (!key) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'circle-screen__quick-action';
    btn.dataset.actionKey = key;
    btn.textContent = tr(featureActionLabelKey(key));
    if (typeof onAction === 'function') {
      btn.addEventListener('click', () => onAction(key));
    } else {
      btn.disabled = true;
    }
    row.appendChild(btn);
  }
  section.appendChild(row);
}

function renderAnnouncement(section, block, _tr) {
  const body = document.createElement('p');
  body.className = 'circle-screen__announcement-text';
  body.textContent = block.content?.text ?? '';
  section.appendChild(body);
}

function renderText(section, block, _tr) {
  const body = document.createElement('p');
  body.className = 'circle-screen__text-body';
  body.textContent = block.content?.text ?? '';
  section.appendChild(body);
}

function renderPhoto(section, block, _tr) {
  const img = document.createElement('img');
  img.className = 'circle-screen__photo';
  img.src = block.content?.src ?? '';
  img.alt = block.content?.caption ?? '';
  section.appendChild(img);
  const caption = (block.content?.caption ?? '').trim();
  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'circle-screen__photo-caption';
    cap.textContent = caption;
    section.appendChild(cap);
  }
}

function renderNoticeboard(section, block, tr) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.noticeboard');
  section.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-screen__noticeboard-list';
  for (const row of block.content?.items ?? []) {
    const li = document.createElement('li');
    li.className = 'circle-screen__noticeboard-row';
    li.dataset.rowId = row.id ?? '';
    // Stamped by `materializeNoticeboard` through the reveal ladder (batch 4) — paint only.
    const sender = row?.senderSelf
      ? null
      : (row?.senderLabel ?? (row?.senderLabelKey ? tr(row.senderLabelKey) : null));
    if (sender) {
      const s = document.createElement('span');
      s.className = 'circle-screen__noticeboard-sender';
      s.textContent = sender;
      li.appendChild(s);
    }
    const text = document.createElement('span');
    text.className = 'circle-screen__noticeboard-text';
    text.textContent = pickRowText(row);
    li.appendChild(text);
    list.appendChild(li);
  }
  section.appendChild(list);
}

function renderAgenda(section, block, tr, highlightRef) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.agenda');
  section.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-screen__agenda-list';
  for (const ev of block.content?.items ?? []) {
    const li = document.createElement('li');
    li.className = 'circle-screen__agenda-row';
    li.dataset.eventId = ev.id ?? '';
    const lbl = document.createElement('span');
    lbl.className = 'circle-screen__agenda-label';
    lbl.textContent = ev.label ?? '';
    li.appendChild(lbl);
    // S6.B — a chip-tap that referenced this event flashes its row + scrolls to it.
    if (matchesHighlight(ev.id, highlightRef)) {
      li.classList.add('circle-screen__agenda-row--highlight');
      scrollRowIntoView(li);
    }
    list.appendChild(li);
  }
  section.appendChild(list);
}

function renderTasks(section, block, tr, onEmbedOpen, highlightRef) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.tasks');
  section.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-screen__tasks-list';
  for (const task of block.content?.items ?? []) {
    const li = document.createElement('li');
    li.className = 'circle-screen__tasks-row';
    li.dataset.taskId = task.id ?? '';
    li.dataset.state = task.state ?? '';
    // S6.B — a chip-tap that referenced this task flashes its row + scrolls to it.
    if (matchesHighlight(task.id, highlightRef)) {
      li.classList.add('circle-screen__tasks-row--highlight');
      scrollRowIntoView(li);
    }
    if (task.circleName) {
      const tag = document.createElement('span');
      tag.className = 'circle-screen__tasks-circle';
      tag.textContent = task.circleName;
      li.appendChild(tag);
    }
    const text = document.createElement('span');
    text.className = 'circle-screen__tasks-text';
    text.textContent = task.text ?? '';
    li.appendChild(text);
    // embeds[] — "See also" chips for the task's cross-object references.
    const embeds = embedChipsOf(task);
    if (embeds.length) {
      const wrap = document.createElement('span');
      wrap.className = 'circle-screen__embeds';
      for (const e of embeds) {
        const screen = screenForEmbedType(e.type);
        const tappable = !!(screen && !e.locked && typeof onEmbedOpen === 'function');
        const chip = document.createElement(tappable ? 'button' : 'span');
        if (tappable) chip.type = 'button';
        chip.className = `circle-screen__embed circle-screen__embed--${e.type}${tappable ? ' circle-screen__embed--tappable' : ''}`;
        chip.dataset.ref = e.ref;
        const typeKey = embedTypeLabelKey(e.type);
        const typeLabel = tr(typeKey);
        const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
        chip.textContent = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
        if (tappable) chip.addEventListener('click', () => onEmbedOpen({ type: e.type, ref: e.ref, screen }));
        wrap.appendChild(chip);
      }
      li.appendChild(wrap);
    }
    list.appendChild(li);
  }
  section.appendChild(list);
}

function renderRules(section, block, tr) {
  const title = document.createElement('h3');
  title.className = 'circle-screen__block-title';
  title.textContent = tr('circle.recipe.block.rules');
  section.appendChild(title);

  const doc = block.content?.doc ?? {};
  for (const field of ['purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility']) {
    const value = (doc[field] ?? '').trim();
    if (!value) continue;
    const dl = document.createElement('div');
    dl.className = `circle-screen__rules-field circle-screen__rules-field--${field}`;
    const dt = document.createElement('div');
    dt.className = 'circle-screen__rules-label';
    dt.textContent = tr(`circle.rules.field.${field}`);
    const dd = document.createElement('div');
    dd.className = 'circle-screen__rules-value';
    dd.textContent = value;
    dl.appendChild(dt); dl.appendChild(dd);
    section.appendChild(dl);
  }
}

/* ─────────────────────────────────────────────────────────────────────── */

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name', 'message']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return '';
}
