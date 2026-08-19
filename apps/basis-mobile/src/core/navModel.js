/**
 * Project the merged manifest catalogue through renderMobile to get
 * a NavModel per app.  renderMobile is a strict-equivalence re-
 * export of renderWeb (see packages/app-manifest/test/
 * crossSurfaceEquivalence.test.js), so the same screens that web
 * basis could show via renderWeb come out here.
 *
 * Portable.  The actual RN screens that CONSUME these NavModels
 * live in ../rn/screens/.
 */
// Relative imports — see composeManifests.js for the rationale.
import { renderMobile } from '@onderling/app-manifest';

// The per-app manifest list is owned by composeManifests.js (the single
// source of truth); we consume it here so the nav order can't drift from
// the dispatch catalogue.  This drift is exactly what re-opened once — nav
// hardcoded household-before-tasks while the catalogue (deliberately, #49)
// orders tasks-before-household — and 's "same order" smoke test
// caught it.  Reusing _internalManifestList keeps them 1:1 by construction.
import { _internalManifestList } from './composeManifests.js';

/**
 * @returns {{appOrigin: string, nav: object}[]}  one entry per app,
 *   in the order they show up in the bottom-tab nav (chat/basis
 *   first, then content apps).  Matches the composeManifests order 1:1
 *   because it reads the SAME manifest list — so the boot-debug nav list
 *   lines up with the merged catalogue.
 */
export function buildNavModels({ householdManifest } = {}) {
  const manifests = _internalManifestList({ householdManifest });
  return manifests.map((m) => ({ appOrigin: m.app, nav: renderMobile(m) }));
}
