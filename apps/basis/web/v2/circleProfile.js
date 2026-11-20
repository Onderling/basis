/**
 * basis v2 — the short view of the persona panel (web DOM renderer): the declared Me, painted into the panel's body.
 *
 * What it shows is declared in the manifest, never listed here: the Me actions (`meActions` — share my card) and the
 * Me blocks (`meBlocks` — the identity line with the name and "Aanpassen", the devices and helpers), which the host
 * fills through the shared `mijScreenBlocks` and this paints with the screen's own block painter. The settings are
 * behind the settings button beside the persona button; what is about now is on Vandaag.
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
