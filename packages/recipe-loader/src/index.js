/**
 * @onderling/recipe-loader — B #64: loader + validator for AUTHORED REMOTE recipes.
 *
 * Layer: substrate. A recipe is a third-party `{capabilities, settings,
 * surfaces, freedoms}` circle-configuration bundle hosted off-app and run
 * LOCALLY — a way for someone to author which capabilities a circle enables,
 * the settings defaults, the surface layout, and the freedom template, then
 * share it as a file others load. This package is the LOADER: it fetches
 * (via an injected `fetch`), parses, validates each section against the
 * shapes `@onderling/app-manifest` already owns (`isRegistryType`, `isAtom`,
 * `FREEDOM_LEVELS`, `OPT_OUT_CONSEQUENCES`), trust-gates via an injected
 * `verify` (deny-by-default), and returns a normalised bundle.
 *
 * NOT this package:
 *   - basis's IN-CIRCLE `circleRecipe*` member-to-member broadcast — a
 *     different mechanism (live members, not an external authored file).
 *   - the APPLY-WIRING (loaded recipe → active circle policy) — DEFERRED to
 *     basis, which owns the feature/view enums + installed manifests.
 *   - real signature crypto — the `verify` seam is the plug-in point.
 *
 * Depends on `@onderling/app-manifest` for validation primitives. Does not depend
 * up on any app (layering invariant #5).
 */

export { loadRecipe } from './loadRecipe.js';
export { validateRecipe } from './validateRecipe.js';
export { RECIPE_CODES, ISSUE_CODES, WARNING_CODES } from './errors.js';
