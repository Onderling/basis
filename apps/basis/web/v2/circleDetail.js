/**
 * basis v2 — circle detail (web DOM renderer).
 *
 * The scoped view you land on when opening a circle from the launcher
 * (F1). Pure render: back action + circle header + a list of the
 * circle's (already-scoped) items. Host fetches + scopes the items
 * (via `scopeItems`); this stays unit-testable under happy-dom.
 *
 * 5.9d — passive Proof-of-Location row sits between the header meta
 * and the items list. Host probes `getPolStatus` via the shared
 * `getCirclePolStatus` helper and passes a `{configured,…}` shape in
 * as `pol`; we just render. Placeholder seam — real attestation in
 * [[5.9d-followup]].
 */
import { circleActions } from '../../src/v2/actionProjection.js';
import { basisManifest } from '../../src/index.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

// D / Surface 2 — the detail-bar CSS token per action id.  Purely shell-side
// styling (the manifest carries no CSS): keeps each button's original class
// (`circle-detail__back`, `__mine`, `__viewas`, …) so `circle.css`'s
// `[class^="circle-detail__"]:not(.circle-detail__back)` bar rule still applies,
// with new destinations (recipes/admin/lists/share) auto-inheriting it.
const CSS_TOKEN = {
  back: 'back', override: 'mine', settings: 'settings', viewAs: 'viewas',
  advisor: 'advisor', skills: 'skills', files: 'files', rules: 'rules',
  recipes: 'recipes', admin: 'admin', lists: 'lists', share: 'share',
};

export function renderCircleDetail(container, {
  circle = {},
  items = [],
  pol = null,
  // gate feature-bound action buttons on the circle's Functies axis
  // . Null/undefined → feature defaults apply. Passed to the shared
  // `circleActions` selector, which evaluates each action's `requires` gate.
  policy = null,
  t,
  onBack,
  onSettings,
  onMine,
  onViewAs,
  onAdvisor,
  onSkills,
  onFiles,
  onRules,
  onRecipes,
  onAdmin,
  onLists,
  onShare,
} = {}) {
  const tr = translatorOr(t, 'circleDetail.js');
  container.innerHTML = '';
  container.classList.add('circle-detail');

  // D / Surface 2 — the action roster is PROJECTED from `manifest.actions` via
  // the shared `circleActions` selector (platform + feature gated), NOT a
  // hand-written button list.  id → the host-wired handler; the callback
  // contract (onBack/onSettings/…) is unchanged, keyed by the projected id.
  const handlers = {
    back: onBack, override: onMine, settings: onSettings, viewAs: onViewAs,
    advisor: onAdvisor, skills: onSkills, files: onFiles, rules: onRules,
    recipes: onRecipes, admin: onAdmin, lists: onLists, share: onShare,
  };

  const bar = document.createElement('div');
  bar.className = 'circle-detail__bar';
  for (const action of circleActions(basisManifest, { policy, platform: 'web' })) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `circle-detail__${CSS_TOKEN[action.id] ?? action.id}`;
    btn.dataset.action = action.id;
    btn.textContent = tr(action.labelKey);
    const on = handlers[action.id];
    btn.addEventListener('click', () => { if (typeof on === 'function') on(); });
    bar.appendChild(btn);
  }
  container.appendChild(bar);

  const head = document.createElement('h2');
  head.className = 'circle-detail__title';
  head.textContent = circle.name || circle.id || '';
  container.appendChild(head);

  if (circle.memberCount != null) {
    const meta = document.createElement('div');
    meta.className = 'circle-detail__meta';
    meta.textContent = tr('circle.members', { count: circle.memberCount });
    container.appendChild(meta);
  }

  // Proof-of-Location row removed 2026-06-25 (parked feature). The seam stays
  // (src/v2/circlePol.js + getPolStatus + circle.pol.* locale); re-add this row to re-surface it.
  void pol;

  const list = document.createElement('div');
  list.className = 'circle-detail__items';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-detail__empty';
    empty.textContent = tr('circle.detail_empty');
    list.appendChild(empty);
  } else {
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'circle-detail__item';
      row.textContent = itemLabel(it);
      list.appendChild(row);
    }
  }
  container.appendChild(list);
  return container;
}

function itemLabel(it = {}) {
  return it.title || it.text || it.name || it.label || String(it.id ?? '');
}
