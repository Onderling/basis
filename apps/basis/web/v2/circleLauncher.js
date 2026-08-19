/**
 * basis v2 — circle launcher (web DOM renderer).
 *
 * Pure render over a circle list; the host injects data + handlers +
 * `t`. Mirrors the `renderSidebar(container, ctx)` pattern. No data
 * fetching, no agent — that lives in the host boot (`circleApp.js`), so
 * this stays unit-testable under happy-dom.
 */

import { circleTint } from '../../src/v2/theme.js';

// β.3 — fixed display order for circle-kind section headers; anything not in
// this list is bucketed under 'other' (last).  Mirrors the values produced by
// the create wizard + circleModel.normalizeCircle (`raw.kind ?? raw.tone`).
const KIND_ORDER = ['household', 'buurt', 'friends'];

export function renderCircleLauncher(container, {
  circles = [],
  // per-circle preview map ({subtitle, ts, unread}); host computes
  // via `buildTilePreviews` over the EventLog.  Null/absent → tiles show
  // the member-count fallback (current behaviour).
  previews = null,
  // followup — per-circle pending proposal counts keyed by id.
  // Host computes via `pendingApprovers` for circles with admin-approval
  // axes.  Tiles show a yellow voorstellen badge when > 0.
  proposals = null,
  // β.5 — per-circle "pin to top" map ({circleId: true}).  Pinned tiles
  // float to the top of their kind section without escaping the β.3
  // grouping invariant.  Host loads via circlePinStore at boot.
  pinnedMap = {},
  t,
  onOpenCircle,
  onNewCircle,
  onJoinCircle,   // OBJ-2 — join an existing circle from an invite (scan/paste)
  // β.5 — per-tile context-menu callbacks.  When absent, right-click is
  // a no-op (so headless usage / tests that don't pass handlers still
  // behave).  Every handler is `(circleId) => void`.
  onPin,
  onMute,
  onSettings,
  onLeave,
  // β.5 — per-circle mute flag map ({circleId: true}) so the menu can
  // toggle the label between Mute / Unmute.  Host derives this from the
  // memberOverride store (chatOff flag); absent = treat as unmuted.
  mutedMap = {},
  loading = false,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-launcher');

  const heading = document.createElement('h2');
  heading.className = 'circle-launcher__title';
  heading.textContent = tr('circle.title');
  container.appendChild(heading);

  // β.1 — top-row Stream/Availability/Hop/Nearby/My-things buttons removed;
  // those surfaces are now reachable via the Schermen + Mij tabs.

  if (loading) {
    const l = document.createElement('div');
    l.className = 'circle-launcher__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  if (!circles.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-launcher__empty';
    empty.textContent = tr('circle.empty');
    container.appendChild(empty);
  }

  // β.2 — sort by recent activity (preview.ts desc); stable name tiebreak.
  const sorted = [...circles].sort((a, b) => {
    const ta = previews?.[a.id]?.ts ?? 0;
    const tb = previews?.[b.id]?.ts ?? 0;
    if (tb !== ta) return tb - ta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  // β.5 — partition pinned + unpinned (within the already-sorted list, so
  // β.2 ordering applies among pins, then again among unpins).  The
  // partitioning happens BEFORE β.3 grouping so a pin can't escape its
  // kind section — pins float to the top of their own section only.
  const pinned = sorted.filter((c) => pinnedMap?.[c.id]);
  const unpinned = sorted.filter((c) => !pinnedMap?.[c.id]);
  const ordered = [...pinned, ...unpinned];

  // β.3 — group by circle kind in KIND_ORDER, then 'other'.  When all circles
  // share a single kind the headers are skipped (degenerate-case parity with
  // the pre-β.3 flat list look).
  const groups = new Map();
  for (const c of ordered) {
    const k = KIND_ORDER.includes(c.kind) ? c.kind : 'other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const orderedKinds = [...KIND_ORDER, 'other'].filter((k) => groups.has(k));
  const showHeaders = orderedKinds.length > 1;

  const tileHandlers = { onOpenCircle, onPin, onMute, onSettings, onLeave };

  if (showHeaders) {
    for (const kind of orderedKinds) {
      const section = document.createElement('section');
      section.className = 'circle-launcher__section';
      section.dataset.kind = kind;
      const title = document.createElement('h3');
      title.className = 'circle-launcher__section-title';
      title.textContent = tr(`circle.kind.${kind}`);
      section.appendChild(title);
      const list = document.createElement('div');
      list.className = 'circle-launcher__list';
      for (const c of groups.get(kind)) {
        list.appendChild(renderTile(c, {
          previews, proposals, pinnedMap, mutedMap, tr, handlers: tileHandlers,
        }));
      }
      section.appendChild(list);
      container.appendChild(section);
    }
  } else {
    const list = document.createElement('div');
    list.className = 'circle-launcher__list';
    for (const c of ordered) {
      list.appendChild(renderTile(c, {
        previews, proposals, pinnedMap, mutedMap, tr, handlers: tileHandlers,
      }));
    }
    container.appendChild(list);
  }

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'circle-launcher__new';
  newBtn.textContent = tr('circle.new');
  newBtn.addEventListener('click', () => {
    if (typeof onNewCircle === 'function') onNewCircle();
  });
  container.appendChild(newBtn);

  // OBJ-2 — join an existing circle from an invite (scan/paste). Sibling of "+ new circle".
  if (typeof onJoinCircle === 'function') {
    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'circle-launcher__join';
    joinBtn.textContent = tr('circle.join.button');
    joinBtn.addEventListener('click', () => onJoinCircle());
    container.appendChild(joinBtn);
  }

  return container;
}

/** Render one circle tile.  Extracted in β.3 so grouped + flat paths share it. */
function renderTile(c, { previews, proposals, pinnedMap, mutedMap, tr, handlers }) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'circle-tile';
  tile.dataset.circleId = c.id;
  if (c.kind) tile.dataset.kind = c.kind;
  const isPinned = Boolean(pinnedMap?.[c.id]);
  if (isPinned) tile.classList.add('is-pinned');

  const avatar = document.createElement('div');
  avatar.className = 'circle-tile__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.style.background = circleTint(c.id);
  avatar.textContent = circleInitial(c.name);
  tile.appendChild(avatar);

  const body = document.createElement('div');
  body.className = 'circle-tile__body';
  const name = document.createElement('div');
  name.className = 'circle-tile__name';
  name.textContent = c.name;
  body.appendChild(name);

  // activity subtitle replaces the member-count line when a
  // recent event carries renderable text. Falls back to
  // member-count when the preview map has no subtitle for this id.
  const preview = previews ? previews[c.id] : null;
  if (preview && typeof preview.subtitle === 'string' && preview.subtitle) {
    const meta = document.createElement('div');
    meta.className = 'circle-tile__meta';
    meta.textContent = preview.subtitle;
    body.appendChild(meta);
  } else if (c.memberCount != null) {
    const meta = document.createElement('div');
    meta.className = 'circle-tile__meta';
    meta.textContent = tr('circle.members', { count: c.memberCount });
    body.appendChild(meta);
  }
  tile.appendChild(body);

  // unread badge (red circle with the count). Surfaces only
  // when the preview has unread > 0.
  if (preview && preview.unread > 0) {
    const badge = document.createElement('span');
    badge.className = 'circle-tile__unread';
    badge.setAttribute('aria-label', tr('circle.tile_unread', { count: preview.unread }));
    badge.textContent = String(preview.unread);
    tile.appendChild(badge);
  }

  // pending-voorstellen badge (yellow) when this circle
  // has admin-approval proposals waiting on me.
  const pending = proposals && Number(proposals[c.id]) > 0 ? Number(proposals[c.id]) : 0;
  if (pending > 0) {
    const vb = document.createElement('span');
    vb.className = 'circle-tile__proposals';
    vb.setAttribute('aria-label', tr('circle.tile_proposals', { count: pending }));
    vb.textContent = String(pending);
    tile.appendChild(vb);
  }

  // β.5 — pin indicator (small glyph in the top-right corner of pinned tiles).
  if (isPinned) {
    const pinIndicator = document.createElement('span');
    pinIndicator.className = 'circle-tile__pin-indicator';
    pinIndicator.setAttribute('aria-hidden', 'true');
    pinIndicator.textContent = '\u{1F4CC}'; // 📌
    tile.appendChild(pinIndicator);
  }

  tile.addEventListener('click', () => {
    if (typeof handlers?.onOpenCircle === 'function') handlers.onOpenCircle(c.id, c);
  });

  // β.5 — right-click opens the per-tile context menu (pin / mute /
  // settings / leave).  Suppressed when no menu handlers are wired so
  // legacy callers (and tests not exercising this path) keep the
  // native browser menu.
  const hasMenuHandlers = ['onPin', 'onMute', 'onSettings', 'onLeave']
    .some((k) => typeof handlers?.[k] === 'function');
  if (hasMenuHandlers) {
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTileMenu(tile, c, { pinnedMap, mutedMap, tr, handlers });
    });
  }

  return tile;
}

/**
 * β.5 — open the per-tile context menu next to `tile`.  Dismisses any
 * previously-open menu first (only one menu open at a time, anywhere in
 * the launcher).  Outside-click and Escape close the menu.
 */
function openTileMenu(tile, circle, { pinnedMap, mutedMap, tr, handlers }) {
  // Remove any existing menu first (single-instance).
  for (const old of document.querySelectorAll('.circle-launcher__tile-menu')) {
    old.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'circle-launcher__tile-menu';
  menu.setAttribute('role', 'menu');
  menu.dataset.circleId = circle.id;
  // Position next to the tile (absolute, container = body for simplicity).
  // CSS handles the visual styling; we just stamp coords so the menu
  // sits beside the tile rather than at (0,0).
  const rect = tile.getBoundingClientRect();
  const scrollX = (typeof window !== 'undefined' && window.scrollX) || 0;
  const scrollY = (typeof window !== 'undefined' && window.scrollY) || 0;
  menu.style.left = `${rect.right + scrollX - 4}px`;
  menu.style.top  = `${rect.top + scrollY + 4}px`;

  const close = () => {
    menu.remove();
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  function onOutside(e) {
    if (!menu.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  const isPinned = Boolean(pinnedMap?.[circle.id]);
  const isMuted  = Boolean(mutedMap?.[circle.id]);

  const items = [
    {
      action: 'pin',
      label: tr(isPinned ? 'circle.tile.menu.unpin' : 'circle.tile.menu.pin'),
      handler: handlers.onPin,
    },
    {
      action: 'mute',
      label: tr(isMuted ? 'circle.tile.menu.unmute' : 'circle.tile.menu.mute'),
      handler: handlers.onMute,
    },
    {
      action: 'settings',
      label: tr('circle.tile.menu.settings'),
      handler: handlers.onSettings,
    },
    {
      action: 'leave',
      label: tr('circle.tile.menu.leave'),
      handler: handlers.onLeave,
    },
  ];

  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'circle-launcher__tile-menu-item';
    btn.dataset.action = item.action;
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      if (typeof item.handler === 'function') item.handler(circle.id, circle);
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  // Defer outside/Escape listeners by a tick so the contextmenu event
  // that opened the menu doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

/** First letter of a circle name for the avatar tile. */
function circleInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : '·';
}
