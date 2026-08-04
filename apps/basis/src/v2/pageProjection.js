/**
 * D / consumer-switch — thin selectors over renderWeb's PAGE
 * projection (`NavModel.pages[]`).
 *
 * Invariant #1 (logic lives once, in shared code): the NavModel is built
 * by the PURE `renderWeb` projector; page selection + label resolution
 * live here in shared `src/`, NOT hand-assembled inside a web DOM
 * renderer.  The web shell stays a thin adapter that just calls these
 * and drops the result into the DOM.
 *
 * Invariant #4 (the manifest is the source of truth for surfaces): a
 * running surface that reads a page's header label from here is a
 * genuine consumer of the manifest projection — the label flows
 * `manifest.surfaces.page.labelKey → renderWeb → pageLabel → t()`,
 * never a hardcoded string.
 */
import { renderWeb, renderMobile } from '@onderling/app-manifest';

/**
 * All top-level PAGE surfaces a manifest projects, in declaration order.
 * Empty array when the manifest declares no `surfaces.page` op (the projector
 * omits the `pages` key in that case — see renderWeb.js).
 *
 * `renderer` selects the projector so this ONE shared module serves BOTH
 * surfaces (invariant #1/#2): web passes the default `renderWeb`, mobile the
 * sibling `manifestPagesMobile`/`pageForOpMobile` (which inject `renderMobile`).
 * V0 renderMobile === renderWeb, so today both yield identical pages; keeping
 * the seam here means a future mobile-only NavModel field never forks the
 * selection/label logic.
 *
 * @param {object} manifest
 * @param {Function} [renderer] — the pure projector (`renderWeb` | `renderMobile`)
 * @returns {Array<{opId: string, kind: string, title?: string, route?: string, labelKey?: string}>}
 */
export function manifestPages(manifest, renderer = renderWeb) {
  const nav = renderer(manifest);
  return Array.isArray(nav.pages) ? nav.pages : [];
}

/**
 * The projected `Page` for one op (the op that declares `surfaces.page`),
 * or `null` when the op doesn't declare a page surface.
 *
 * @param {object} manifest
 * @param {string} opId
 * @param {Function} [renderer] — the pure projector (`renderWeb` | `renderMobile`)
 * @returns {object|null}
 */
export function pageForOp(manifest, opId, renderer = renderWeb) {
  return manifestPages(manifest, renderer).find((p) => p.opId === opId) ?? null;
}

/**
 * Mobile siblings — SAME selection logic, `renderMobile` projector. A mobile
 * RN screen selects its header page over `renderMobile(manifest).pages` here
 * instead of duplicating the selection in the screen (invariant #1/#3).
 *
 * @param {object} manifest
 * @param {string} opId
 */
export function manifestPagesMobile(manifest) {
  return manifestPages(manifest, renderMobile);
}
export function pageForOpMobile(manifest, opId) {
  return pageForOp(manifest, opId, renderMobile);
}

/**
 * D-mig-1b (objective D, step 1b) — the shared SECTION selector over
 * renderWeb's list-surface projection (`NavModel.sections[]`).
 *
 * Resolves a live list-screen's config FROM the composed manifests instead
 * of a hardcoded literal: iterate the `manifestsByOrigin` values, run the
 * pure projector, and find the section whose `id === screenId`.  Returns
 * `{ section, appOrigin }` — `appOrigin` is the owning manifest's
 * `app`/`appId` (the key `rawCallSkill` dispatches under) — or `null` when
 * no manifest projects that section.
 *
 * Pure + projector-agnostic (invariant #1): accepts a `renderer` param like
 * the page selectors, defaulting to `renderWeb`, so the ONE shared module
 * serves both surfaces and never forks the selection logic.
 *
 * @param {Object<string, object>} manifestsByOrigin — {appOrigin → manifest}
 * @param {string} screenId — the projected section id (e.g. 'contacts')
 * @param {Function} [renderer] — the pure projector (`renderWeb` | `renderMobile`)
 * @returns {{ section: object, appOrigin: string }|null}
 */
export function sectionForScreen(manifestsByOrigin, screenId, renderer = renderWeb) {
  if (!manifestsByOrigin || typeof manifestsByOrigin !== 'object') return null;
  if (typeof screenId !== 'string' || !screenId) return null;
  const seen = new Set();
  for (const manifest of Object.values(manifestsByOrigin)) {
    if (!manifest || typeof manifest !== 'object' || seen.has(manifest)) continue;
    seen.add(manifest);   // a manifest keyed under both app + appId is scanned once
    const nav = renderer(manifest);
    const sections = Array.isArray(nav.sections) ? nav.sections : [];
    const section = sections.find((s) => s && s.id === screenId);
    if (section) {
      const appOrigin = typeof manifest.app === 'string' && manifest.app
        ? manifest.app
        : (typeof manifest.appId === 'string' ? manifest.appId : '');
      return { section, appOrigin };
    }
  }
  return null;
}

/**
 * Localised header label for a projected `Page` (discipline):
 *   1. `page.labelKey` via `t()` when both are present (the manifest's
 *      localisation key — invariant #8);
 *   2. else the raw `page.title` passthrough (English fallback for
 *      consumers without a `t()`);
 *   3. else the caller-supplied `fallback` (graceful: a page-less /
 *      undefined surface keeps its bespoke label).
 *
 * @param {object|null|undefined} page
 * @param {Function|undefined} t
 * @param {string} [fallback]
 * @returns {string|undefined}
 */
export function pageLabel(page, t, fallback) {
  if (page && typeof page.labelKey === 'string' && page.labelKey && typeof t === 'function') {
    return t(page.labelKey);
  }
  if (page && typeof page.title === 'string' && page.title) return page.title;
  return fallback;
}

/**
 * The declared FLOW behind an op (batch 6) — `manifest.flows[]`, the wizard tier of the surface
 * contract. Both shells gate a wizard mount on this: a wizard whose flow is not declared is a
 * surface the manifest does not admit to having (the twin-reachability rule, applied to flows —
 * G-S3 holds the declaration itself against the state module it describes).
 *
 * Accepts one manifest or a merged-source list (`[{manifest}, …]`), because the shells hold the
 * latter and the guard holds the former.
 *
 * @param {object|Array<object|{manifest: object}>} manifestOrSources
 * @param {string} opId
 * @returns {object|null} the flow declaration, or null when no manifest declares one for this op.
 */
export function flowForOp(manifestOrSources, opId) {
  const list = Array.isArray(manifestOrSources)
    ? manifestOrSources.map((s) => s?.manifest ?? s)
    : [manifestOrSources];
  for (const m of list) {
    const flow = (Array.isArray(m?.flows) ? m.flows : []).find((f) => f?.opId === opId);
    if (flow) return flow;
  }
  return null;
}
