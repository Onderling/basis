/**
 * The actions at the top of Me ("Share my card", "Scan") — a thin selector over renderWeb's `NavModel.meActions`, the
 * one module both shells read (web `circleProfile.js`, mobile `CircleProfileScreen.js`), exactly as the tab bar reads
 * `tabProjection.js`. The roster lives ONCE, in `manifest.meActions`.
 */
import { renderWeb, renderMobile } from '@onderling/app-manifest';

/**
 * @param {object} manifest
 * @param {Function} [renderer] — `renderWeb` | `renderMobile`
 * @returns {Array<{id: string, labelKey: string, target: object}>}
 */
export function meActionsFor(manifest, renderer = renderWeb) {
  const nav = renderer(manifest);
  return Array.isArray(nav.meActions) ? nav.meActions : [];
}

/** Mobile sibling — the same selection over `renderMobile`. */
export function meActionsMobile(manifest) {
  return meActionsFor(manifest, renderMobile);
}
