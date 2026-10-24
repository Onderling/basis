/**
 * basis v2 — Mij (web DOM renderer): identity, ONE declared screen.
 *
 * What Me shows is declared in the manifest, never listed here: the Me actions (`meActions` — share my card, scan)
 * and the Me blocks (`meBlocks` — the identity line with the person's name and readings, their agents and devices),
 * which the host fills through the shared `mijScreenBlocks` and this paints with the screen's own block painter.
 * Below them, one door to My data (where the other doors went) and, behind the developer switch, Advanced. The
 * identity fields and the location are in the person's own editor (the identity line's "Edit"); the overview is on
 * Vandaag.
 *
 * The page's fallback title (no name yet) comes from the manifest PAGE projection: the `me` op declares
 * `surfaces.page`, and its labelKey flows through the shared `pageLabel` selector.
 */
import { pageLabel } from '../../src/v2/pageProjection.js';
import { meActionsFor } from '../../src/v2/meActionProjection.js';
import { basisManifest } from '../../src/index.js';
import { translatorOr } from '../../src/locales/translatorOr.js';
import { renderCircleScreen } from './circleScreen.js';

export function renderCircleProfile(container, {
  t,
  // the materialized Me blocks (`mijScreenBlocks`); null while they load
  blocks = null,
  // what a block's tap means here: `{ kind: 'edit-me' }` (the identity line's door) · `{ kind: 'open-my-data' }`
  onBlockAction,
  // The gear in Me's header: the person's settings (Instellingen). Absent ⇒ no gear.
  onSettings,
  // The advanced surface — surface-less ops + settable params; given only when the developer switch is on.
  onAdvanced,
  // The Me actions (Share my card · Scan) — DECLARED in the manifest (`meActions`), painted here from the projection;
  // this one callback carries the chosen id back (like the tab bar's handlers). Absent ⇒ none painted.
  onMeAction,
  // the projected PAGE surface for the `me` op: the title while the name is not known
  profilePage = null,
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleProfile.js');
  container.innerHTML = '';
  container.className = 'cc-profile';
  const fallbackTitle = pageLabel(profilePage, tr, tr('circle.profile.title'));

  // the declared blocks; the identity line carries the page's title (the name)
  const body = document.createElement('div');
  body.className = 'cc-profile__blocks';
  renderCircleScreen(body, {
    blocks,
    t: (k, v) => (k === 'circle.profile.title' ? fallbackTitle : tr(k, v)),
    onAction: typeof onBlockAction === 'function' ? onBlockAction : undefined,
  });

  // ── the Me actions, from the declaration (Share my card · Scan) ──
  if (typeof onMeAction === 'function') {
    const row = document.createElement('div');
    row.className = 'cc-profile__me-actions';
    for (const a of meActionsFor(basisManifest)) row.appendChild(button(tr(a.labelKey), `cc-profile__${a.id}`, () => onMeAction(a.id)));
    // under the name: the identity line is the first block
    const first = body.firstElementChild;
    if (first && first.dataset?.blockType === 'identityLine') first.after(row); else container.appendChild(row);
  }
  container.prepend(body);
  // while the blocks load (or a page without the identity line): the page's own title, so Me is never untitled
  if (!body.querySelector('.cc-profile__title')) {
    const heading = document.createElement('h2');
    heading.className = 'cc-profile__title';
    heading.textContent = fallbackTitle;
    container.prepend(heading);
  }

  // ── the gear: the person's settings (Instellingen), top right of Me ──
  if (typeof onSettings === 'function') {
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'cc-profile__gear';
    gear.textContent = '⚙';
    gear.title = tr('circle.settings_home.title');
    gear.setAttribute('aria-label', tr('circle.settings_home.title'));
    gear.addEventListener('click', () => onSettings());
    const bar = document.createElement('div');
    bar.className = 'cc-profile__topbar';
    bar.appendChild(gear);
    container.prepend(bar);
  }

  // ── one door to My data; Advanced only behind the developer switch ──
  if (typeof onAdvanced === 'function') container.appendChild(button(tr('circle.advanced.title'), 'cc-profile__advanced', onAdvanced));
  return container;

  function button(text, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cc-btn cc-btn--quiet ${cls}`;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
