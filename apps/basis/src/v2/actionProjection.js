/**
 * Nav-chrome (D / Surface 2) — thin selectors over renderWeb's DETAIL
 * ACTION BAR projection (`NavModel.actions[]`), the sibling of the tab-bar
 * `tabProjection.js`.
 *
 * Invariant #1 (logic lives once, in shared code): the NavModel is built by the
 * PURE `renderWeb` projector; the action roster + its context-gating live here
 * in shared `src/`, NOT re-declared as a hand-written button list inside each
 * shell's detail renderer.  Both shells (web `web/v2/circleDetail.js`, mobile
 * `CircleLauncherScreen.js`'s `CircleDetail`) import this ONE module, so the
 * detail-bar ids + locale keys + gates exist ONCE — in the manifest
 * (invariants #2/#3).  web ≡ mobile by construction.
 *
 * Invariant #4 (the manifest is the source of truth for surfaces): a shell that
 * reads its action roster from here is a genuine consumer of the projection —
 * the roster flows `manifest.actions → renderWeb → circleActions`, never a
 * hardcoded array.
 *
 * The projected `NavModel.actions` is IDENTICAL for renderWeb and renderMobile
 * (renderMobile re-exports renderWeb) — that is the "divergence gone" guarantee.
 * Each shell then FILTERS the identical roster by:
 *   - `platforms` — the action's declared platform availability (absent → all).
 *     e.g. `share` is `['mobile']` (no web CircleShareScreen yet), so it drops
 *     out on web declaratively — not via a divergent hardcoded list.
 *   - `requires`  — the feature-flag gate (OR semantics), evaluated against the
 *     circle policy with the SAME `isFeatureEnabled` both shells used before.
 */
import { renderWeb, renderMobile } from '@onderling/app-manifest';
import { alphaActions } from './alphaSurface.js';
import { isFeatureEnabled } from './circlePolicy.js';

/**
 * True when an action is available in the given platform + policy context.
 *   - platform gate: `platforms` absent ⇒ all platforms; else must include it.
 *   - feature gate:  `requires` absent/empty ⇒ ungated; else shown when ANY
 *                    listed feature is enabled (OR — matches `lists || notes`).
 */
function actionAllowed(action, policy, platform) {
  if (Array.isArray(action.platforms) && !action.platforms.includes(platform)) return false;
  if (Array.isArray(action.requires) && action.requires.length > 0) {
    if (!action.requires.some((feature) => isFeatureEnabled(policy, feature))) return false;
  }
  return true;
}

/**
 * The ordered DETAIL ACTION BAR roster a manifest projects, filtered to the
 * actions available in this platform + policy context (declaration order).
 * Empty array when the manifest declares no `actions`.
 *
 * Each entry: `{ id, labelKey, icon?, target, requires?, platforms? }` (a
 * NavModel NavItem).
 *
 * @param {object} manifest
 * @param {object} [opts]
 * @param {object|null} [opts.policy]     — circle policy for the feature gate
 * @param {string}      [opts.platform]   — 'web' | 'mobile' (default 'web')
 * @param {Function}    [opts.renderer]   — the pure projector (renderWeb | renderMobile)
 * @returns {Array<object>}
 */
export function circleActions(manifest, opts = {}) {
  // the alpha's trimmed ⋯ menu (alphaSurface.js) — filtered HERE, over the gated roster, so web ≡ mobile
  // without a shell knowing why; the gates themselves stay observable through `gatedActions`.
  return alphaActions(gatedActions(manifest, opts));
}

/**
 * The gated roster BEFORE the alpha trim: every action the manifest declares that this policy and
 * platform allow. What a shell would paint once the alpha widens; what tests of the feature gate and
 * the platform gate assert on, since the trim hides most of the gated ids from the DOM today.
 */
export function gatedActions(manifest, { policy = null, platform = 'web', renderer = renderWeb } = {}) {
  const nav = renderer(manifest);
  const actions = Array.isArray(nav.actions) ? nav.actions : [];
  return actions.filter((action) => actionAllowed(action, policy, platform));
}

/**
 * Mobile sibling — SAME selection + gating logic, `renderMobile` projector and
 * the `'mobile'` platform tag.  The RN detail bar reads its roster over
 * `renderMobile(manifest).actions` here instead of a hand-written ⋯-menu list
 * (invariant #1/#3).
 *
 * @param {object} manifest
 * @param {object} [opts] — same as circleActions; `platform`/`renderer` default to mobile
 * @returns {Array<object>}
 */
export function circleActionsMobile(manifest, opts = {}) {
  return circleActions(manifest, { platform: 'mobile', renderer: renderMobile, ...opts });
}

/**
 * The FULL projected action roster (unfiltered) for a manifest, in declaration
 * order — the platform-neutral projection both shells share.  Exposed so a
 * drift-guard test can assert renderWeb ≡ renderMobile (the divergence is gone
 * by construction) independent of any platform/policy filtering.
 *
 * @param {object} manifest
 * @param {Function} [renderer]
 * @returns {Array<object>}
 */
export function circleActionRoster(manifest, renderer = renderWeb) {
  const nav = renderer(manifest);
  return Array.isArray(nav.actions) ? nav.actions : [];
}
