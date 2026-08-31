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
import { circleTabs } from '../../src/v2/tabProjection.js';
import { basisManifest } from '../../src/index.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleTabBar(container, { active, t, onScreens, onCircles, onNearby, onContacts, onMij } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleTabBar.js');
  // id → the host-wired handler.  Keyed by the projected tab id, so the
  // callback contract (onScreens/onCircles/onContacts/onMij) is unchanged.
  const handlers = { screens: onScreens, circles: onCircles, nearby: onNearby, contacten: onContacts, mij: onMij };
  container.innerHTML = '';
  container.className = 'circle-tabbar';
  for (const tab of circleTabs(basisManifest)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'circle-tabbar__tab';
    btn.dataset.tab = tab.id;
    if (active === tab.id) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'page');
    }
    btn.textContent = tr(tab.labelKey);
    const on = handlers[tab.id];
    btn.addEventListener('click', () => { if (typeof on === 'function') on(); });
    container.appendChild(btn);
  }
  return container;
}

export function hideCircleTabBar(container) {
  if (!container) return;
  container.innerHTML = '';
  container.className = 'circle-tabbar circle-tabbar--hidden';
}
