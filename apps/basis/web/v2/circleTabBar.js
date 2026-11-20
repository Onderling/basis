/**
 * basis v2 — launcher bottom tab bar (web).
 *
 * Screens / Circles / Contacten / Mij — the four top-level surfaces. Shown on
 * the launcher, stream and Me screens; hidden inside a circle + its
 * sub-screens (the host calls `hideCircleTabBar`). Pure render; the host wires
 * handlers.
 *
 * D / Surface 1 — the tab roster (ids + locale keys) is NO LONGER hardcoded
 * here: it is projected from `manifest.tabs` via the shared `circleTabs`
 * selector (invariants #1/#3 — the four ids + `circle.tab.*` keys live ONCE,
 * in the manifest; web ≡ mobile by construction, both consume the same
 * projection).
 */
import { barSlots } from '../../src/v2/plusDial.js';
import { basisManifest } from '../../src/index.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleTabBar(container, { active, t, onScreens, onCircles, onNearby, onContacts, onMij, badges = {}, plus = null } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleTabBar.js');
  // id → the host-wired handler.  Keyed by the projected tab id, so the
  // callback contract (onScreens/onCircles/onContacts/onMij) is unchanged.
  const handlers = { screens: onScreens, circles: onCircles, nearby: onNearby, contacten: onContacts, mij: onMij };
  // THE "+" (shared plusDial.js): `plus = { dial, open, onPress }` from the host, or null on a screen without it. The bar
  // only paints and reports a press — 'plus' (its own spot), a button id, or 'outside'; the host asks the shared
  // `plusPress` what that does.
  const open = !!(plus && plus.open);
  const press = (what) => { if (typeof plus?.onPress === 'function') plus.onPress(what); };
  stopEscape(container);
  container.innerHTML = '';
  container.className = open ? 'circle-tabbar is-dial-open' : 'circle-tabbar';
  if (open) {
    // the dimmed screen: a touch on it folds the buttons back and presses nothing under it
    const backdrop = document.createElement('div');
    backdrop.className = 'circle-plusdial__backdrop';
    backdrop.addEventListener('click', () => press('outside'));
    container.appendChild(backdrop);
  }
  for (const slot of barSlots(basisManifest, { plus: !!plus })) {
    if (slot.kind === 'plus') { container.appendChild(plusSpot(plus, open, tr, press)); continue; }
    const tab = slot.tab;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'circle-tabbar__tab';
    btn.dataset.tab = tab.id;
    if (active === tab.id) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'page');
    }
    btn.textContent = tr(tab.labelKey);
    // A count on a tab (2026-09-21: Contacten's unread, summed) — the host passes `badges: { <tab id>: n }`.
    const n = Number(badges?.[tab.id]) || 0;
    if (n > 0) {
      const badge = document.createElement('span');
      badge.className = 'circle-tabbar__badge';
      badge.textContent = String(n);
      btn.appendChild(badge);
      if (tab.id === 'contacten') btn.setAttribute('aria-label', tr('circle.contacts.unread_tab', { count: n }));
    }
    const on = handlers[tab.id];
    // while the "+" is open the tabs are dimmed with the rest: a touch on one only closes
    btn.addEventListener('click', () => { if (open) { press('outside'); return; } if (typeof on === 'function') on(); });
    container.appendChild(btn);
  }
  if (open) {
    const row = document.createElement('div');
    row.className = 'circle-plusdial';
    for (const b of plus.dial?.around ?? []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-plusdial__btn';
      btn.dataset.dial = b.id;
      btn.textContent = tr(b.labelKey);
      btn.addEventListener('click', () => press(b.id));
      row.appendChild(btn);
    }
    container.appendChild(row);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); press('outside'); } };
    document.addEventListener('keydown', onKey);
    container._plusEscape = onKey;
  }
  return container;
}

/** The "+"'s own spot: closed, the "+"; open, the middle button (or, with none, the "+" that closes). */
function plusSpot(plus, open, tr, press) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'circle-tabbar__plus cc-fab circle-vandaag__plus';
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
  const middle = open ? plus.dial?.middle : null;
  if (middle) {
    b.dataset.dial = middle.id;
    b.classList.add('is-middle');
    b.textContent = tr(middle.labelKey);
  } else {
    b.textContent = open ? '×' : '+';
    const name = open ? tr('circle.plus.close') : tr('circle.vandaag.plus');
    b.title = name;
    b.setAttribute('aria-label', name);
  }
  b.addEventListener('click', () => press('plus'));
  return b;
}

function stopEscape(container) {
  if (container._plusEscape) document.removeEventListener('keydown', container._plusEscape);
  container._plusEscape = null;
}

export function hideCircleTabBar(container) {
  if (!container) return;
  stopEscape(container);
  container.innerHTML = '';
  container.className = 'circle-tabbar circle-tabbar--hidden';
}
