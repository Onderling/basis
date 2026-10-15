/**
 * The actions at the top of Me ("Share my card", "Scan") — a thin selector over renderWeb's `NavModel.meActions`, the
 * one module both shells read (web `circleProfile.js`, mobile `CircleProfileScreen.js`), exactly as the tab bar reads
 * `tabProjection.js`. The roster lives ONCE, in `manifest.meActions`. The doors at the top of My data are the same kind
 * of row (`manifest.myDataActions`), selected here too.
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

/**
 * The doors at the top of My data (`NavModel.myDataActions`), those this shell can open: `open` maps a row's nav `to`
 * (the view) to what opens it here; a row without one is left out.
 * @param {object} manifest
 * @param {Record<string, Function|undefined>} open
 * @param {Function} [renderer]
 * @returns {Array<{id: string, labelKey: string, open: Function}>}
 */
export function myDataActionsFor(manifest, open = {}, renderer = renderWeb) {
  const nav = renderer(manifest);
  return (Array.isArray(nav.myDataActions) ? nav.myDataActions : [])
    .filter((a) => a?.target?.kind === 'nav' && typeof open[a.target.to] === 'function')
    .map((a) => ({ id: a.id, labelKey: a.labelKey, open: open[a.target.to] }));
}

/** Mobile sibling — the same selection over `renderMobile`. */
export function myDataActionsMobile(manifest, open = {}) {
  return myDataActionsFor(manifest, open, renderMobile);
}
