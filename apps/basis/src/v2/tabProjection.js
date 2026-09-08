/**
 * Nav-chrome (D / Surface 1) — thin selectors over renderWeb's TAB-BAR
 * projection (`NavModel.tabs[]`).
 *
 * Invariant #1 (logic lives once, in shared code): the NavModel is built by
 * the PURE `renderWeb` projector; tab selection lives here in shared `src/`,
 * NOT re-declared as a `TABS` literal inside each shell's tab-bar renderer.
 * Both shells (web `circleTabBar.js`, mobile `CircleTabBar.js`) import this
 * ONE module, so the four tab ids + locale keys exist ONCE — in the manifest
 * (invariants #2/#3).
 *
 * Invariant #4 (the manifest is the source of truth for surfaces): a shell
 * that reads its tab roster from here is a genuine consumer of the manifest
 * projection — the roster flows `manifest.tabs → renderWeb → circleTabs`,
 * never a hardcoded array.
 *
 * `renderer` selects the projector so this ONE shared module serves BOTH
 * surfaces: web passes the default `renderWeb`, mobile the sibling
 * `circleTabsMobile` (which injects `renderMobile`).  V0 renderMobile ===
 * renderWeb, so both yield identical tabs today; keeping the seam here means
 * a future mobile-only NavModel field never forks the selection logic.
 */
import { renderWeb, renderMobile } from '@onderling/app-manifest';
import { alphaTabs } from './alphaSurface.js';

/**
 * The ordered top-level TAB BAR roots a manifest projects, in declaration
 * order.  Empty array when the manifest declares no `tabs` (the projector
 * omits the `tabs` key in that case — see renderWeb.js Nav-chrome).
 *
 * Each entry: `{ id, labelKey, icon?, target }` (a NavModel NavItem).
 *
 * @param {object} manifest
 * @param {Function} [renderer] — the pure projector (`renderWeb` | `renderMobile`)
 * @returns {Array<{id: string, labelKey: string, icon?: string, target: object}>}
 */
export function circleTabs(manifest, renderer = renderWeb) {
  const nav = renderer(manifest);
  // The alpha paints a subset (alphaSurface.js); the manifest keeps declaring every tab. Filtering HERE,
  // in the one projection both shells consume, is what keeps web ≡ mobile without a shell knowing why.
  return alphaTabs(Array.isArray(nav.tabs) ? nav.tabs : []);
}

/** Every tab the manifest declares, hidden ones included — for tests and the guard, never for a shell. */
export function allManifestTabs(manifest, renderer = renderWeb) {
  const nav = renderer(manifest);
  return Array.isArray(nav.tabs) ? nav.tabs : [];
}

/**
 * Mobile sibling — SAME selection logic, `renderMobile` projector.  The RN
 * tab bar reads its roster over `renderMobile(manifest).tabs` here instead of
 * duplicating the selection in the screen (invariant #1/#3).
 *
 * @param {object} manifest
 * @returns {Array<{id: string, labelKey: string, icon?: string, target: object}>}
 */
export function circleTabsMobile(manifest) {
  return circleTabs(manifest, renderMobile);
}
