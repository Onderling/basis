/**
 * recipeApply — B #64 APPLY-WIRING: turn a loaded+validated recipe into a
 * circle's ACTIVE POLICY (shared, web ≡ mobile by construction).
 *
 * The LOADER (`@onderling/recipe-loader` `loadRecipe`) shipped separately: it
 * fetches, parses, validates the `{capabilities, settings, surfaces, freedoms}`
 * bundle against the app-manifest primitives (`isRegistryType`/`isAtom`/
 * `FREEDOM_LEVELS`) and trust-gates it. It DEFERRED the last mile — mapping a
 * loaded recipe onto `DEFAULT_CIRCLE_POLICY` — because that needs the
 * basis layer: `CIRCLE_FEATURES` / `CIRCLE_POLICY_ENUMS` (the surface
 * enums) and the INSTALLED MANIFESTS (`sources`) that declare which
 * capabilities/settings actually exist. This module is that last mile.
 *
 * The map (recipe field → active-policy field):
 *   recipe.surfaces.features → policy.features   — validated against CIRCLE_FEATURES.
 *   recipe.surfaces.view     → policy.view        — validated against CIRCLE_POLICY_ENUMS.view.
 *   recipe.capabilities      → policy.capabilities — the ALLOWLIST of enabled (verb×noun) caps.
 *                              Keyed `<noun> → { atoms }` (no app dimension), it is resolved to
 *                              concrete `"<app> <atom> <noun>"` keys via the installed manifests; a
 *                              (noun,atom) no installed manifest declares is a hard DENY (all-or-
 *                              nothing). When present it is an allowlist: every OTHER installed cap
 *                              is written `enabled:false` so the recipe TURNS ON exactly its set.
 *   recipe.freedoms          → policy.capabilities — the per-cap freedom template
 *                              (`{ enabled?, freedom?, consequence?, privacyFloor? }`), overlaid on
 *                              the allowlist. Each key must be a real installed capability (DENY else).
 *   recipe.settings          → policy.settings     — per-app values, SCHEMA-checked against the
 *                              installed manifests' `manifest.settings` (the check the loader deferred).
 *
 * DENY-BY-DEFAULT / ALL-OR-NOTHING: the mapper is pure and never partially
 * applies — any reference to an unknown feature / view / capability / app /
 * setting, or a setting value that doesn't match its declared schema, returns a
 * coded `{ error }` and NO patch. The apply path only persists on a clean map.
 *
 * SECURITY: the produced patch flows through the EXISTING `policyStore.update`
 * (→ `mergeCirclePolicy` → `normalizeCirclePolicy`) and is enforced at the SAME
 * gate: `effectiveCapabilities` recomputes `admin-template ∩ user-prefs` from
 * `policy.capabilities` on the next dispatch. Writing `enabled:false` for the
 * complement makes the gate's effective set exactly the recipe's allowlist — no
 * parallel "recipe policy" state, no bypass of the capability gate.
 */

import { capabilitiesOf, capabilityKey, settingsOf } from '@onderling/app-manifest';
import { loadRecipe } from '@onderling/recipe-loader';
import { CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS } from './circlePolicy.js';

/** Machine error codes (never user-facing strings — the shell maps them via t()). */
export const RECIPE_APPLY_CODES = Object.freeze({
  NOT_RECIPE:        'not-recipe',        // input isn't a loaded recipe object
  NO_SOURCES:        'no-sources',        // capability/setting section present but no installed manifests
  UNKNOWN_FEATURE:   'unknown-feature',   // surfaces.features references a non-CIRCLE_FEATURE
  UNKNOWN_VIEW:      'unknown-view',       // surfaces.view is not a CIRCLE_POLICY_ENUMS.view value
  UNKNOWN_CAPABILITY:'unknown-capability', // a (noun,atom) / freedom key no installed manifest declares
  UNKNOWN_APP:       'unknown-app',        // a setting targets an app that isn't installed
  UNKNOWN_SETTING:   'unknown-setting',    // a setting key the target app doesn't declare
  BAD_SETTING_VALUE: 'bad-setting-value',  // a setting value that doesn't match its declared schema
});

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const err = (code, message, extra = {}) => ({ error: { code, message, ...extra } });

/**
 * Does `value` satisfy the declared `setting`'s schema? Mirrors the widget kinds
 * `buildSettingsForm` renders (toggle|choice|number|text|member). An unknown
 * kind falls through to structural-acceptance (the loader already checked JSON-
 * serialisability), so a new setting kind never hard-fails apply spuriously.
 */
function valueMatchesSetting(setting, value) {
  switch (setting?.kind) {
    case 'toggle': return typeof value === 'boolean';
    case 'choice': return Array.isArray(setting.of) && setting.of.includes(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'text':
    case 'member': return typeof value === 'string';
    default:       return true;
  }
}

/**
 * PURE MAPPER — a loaded recipe → a circle-policy patch (or a coded error).
 *
 * @param {object} recipe   the normalised recipe from `loadRecipe(...).recipe`
 * @param {object} [opts]
 * @param {Array<{manifest:object}>} [opts.sources]  the merged manifest sources (as fed to the gate)
 * @returns {{ patch: object } | { error: { code:string, message:string } }}
 */
export function recipeToCirclePolicyPatch(recipe, { sources = [] } = {}) {
  if (!isPlainObject(recipe)) {
    return err(RECIPE_APPLY_CODES.NOT_RECIPE, 'recipe must be a loaded recipe object');
  }
  const srcs = (Array.isArray(sources) ? sources : []).filter((s) => s?.manifest?.app);

  // The universe of installed capabilities: capKey → {app,atom,noun}, plus a
  // "<noun> <atom>" → [capKey…] index to resolve recipe.capabilities (which
  // carries no app dimension) to concrete keys.
  const universe = new Map();
  const byNounAtom = new Map();
  const manifestByApp = new Map();
  for (const s of srcs) {
    const app = s.manifest.app;
    manifestByApp.set(app, s.manifest);
    for (const cap of capabilitiesOf(s.manifest)) {
      const key = capabilityKey(app, cap.atom, cap.noun);
      universe.set(key, { app, atom: cap.atom, noun: cap.noun });
      const na = `${cap.noun} ${cap.atom}`;
      if (!byNounAtom.has(na)) byNounAtom.set(na, []);
      byNounAtom.get(na).push(key);
    }
  }

  const patch = {};

  // ── surfaces → features + view ────────────────────────────────────────────
  const surfaces = isPlainObject(recipe.surfaces) ? recipe.surfaces : {};
  if (isPlainObject(surfaces.features)) {
    const features = {};
    for (const [feat, on] of Object.entries(surfaces.features)) {
      if (!CIRCLE_FEATURES.includes(feat)) {
        return err(RECIPE_APPLY_CODES.UNKNOWN_FEATURE, `recipe surfaces.features references unknown feature "${feat}"`, { feature: feat });
      }
      features[feat] = !!on;
    }
    if (Object.keys(features).length) patch.features = features;
  }
  if (surfaces.view !== undefined) {
    if (!CIRCLE_POLICY_ENUMS.view.includes(surfaces.view)) {
      return err(RECIPE_APPLY_CODES.UNKNOWN_VIEW, `recipe surfaces.view "${surfaces.view}" is not a valid circle view`, { view: surfaces.view });
    }
    patch.view = surfaces.view;
  }

  // ── capabilities (allowlist) + freedoms (template) → policy.capabilities ───
  const recipeCaps = isPlainObject(recipe.capabilities) ? recipe.capabilities : {};
  const recipeFreedoms = isPlainObject(recipe.freedoms) ? recipe.freedoms : {};
  const hasCaps = Object.keys(recipeCaps).length > 0;
  const hasFreedoms = Object.keys(recipeFreedoms).length > 0;

  if (hasCaps || hasFreedoms) {
    if (universe.size === 0) {
      return err(RECIPE_APPLY_CODES.NO_SOURCES, 'recipe declares capabilities but no installed manifest sources were provided to resolve them');
    }
    const template = {};

    // Resolve the allowlist (noun→atoms → concrete keys); an unknown pair denies.
    const allow = new Set();
    for (const [noun, decl] of Object.entries(recipeCaps)) {
      const atoms = Array.isArray(decl?.atoms) ? decl.atoms : [];
      for (const atom of atoms) {
        const keys = byNounAtom.get(`${noun} ${atom}`);
        if (!keys || keys.length === 0) {
          return err(RECIPE_APPLY_CODES.UNKNOWN_CAPABILITY, `recipe capability "${atom} ${noun}" is not declared by any installed manifest`, { atom, noun });
        }
        for (const k of keys) allow.add(k);
      }
    }

    // With an allowlist present, deny-by-default the complement so the recipe
    // turns on EXACTLY its set (the gate's effective set becomes the allowlist).
    if (hasCaps) {
      for (const key of universe.keys()) template[key] = { enabled: allow.has(key) };
    }

    // Overlay the freedom template; each key must be a real installed capability.
    for (const [key, entry] of Object.entries(recipeFreedoms)) {
      if (!universe.has(key)) {
        return err(RECIPE_APPLY_CODES.UNKNOWN_CAPABILITY, `recipe freedom "${key}" is not a capability of any installed manifest`, { capability: key });
      }
      template[key] = { ...(template[key] || {}), ...entry };
    }

    patch.capabilities = template;
  }

  // ── settings → policy.settings (schema-checked against installed manifests) ─
  const recipeSettings = isPlainObject(recipe.settings) ? recipe.settings : {};
  if (Object.keys(recipeSettings).length) {
    const settings = {};
    for (const [key, value] of Object.entries(recipeSettings)) {
      const dot = key.indexOf('.');
      const app = key.slice(0, dot);
      const settingKey = key.slice(dot + 1);
      const manifest = manifestByApp.get(app);
      if (!manifest) {
        return err(RECIPE_APPLY_CODES.UNKNOWN_APP, `recipe setting "${key}" targets app "${app}" which is not installed`, { app });
      }
      const decl = settingsOf(manifest).find((s) => s?.key === settingKey);
      if (!decl) {
        return err(RECIPE_APPLY_CODES.UNKNOWN_SETTING, `recipe setting "${key}" is not declared by app "${app}"`, { setting: key });
      }
      if (!valueMatchesSetting(decl, value)) {
        return err(RECIPE_APPLY_CODES.BAD_SETTING_VALUE, `recipe setting "${key}" value ${JSON.stringify(value)} does not match its declared schema`, { setting: key });
      }
      settings[key] = value;
    }
    patch.settings = settings;
  }

  return { patch };
}

/**
 * APPLY PATH — map a loaded recipe to a policy patch and PERSIST it through the
 * existing policy store (all-or-nothing; never a partial write on a bad recipe).
 *
 * @param {object} args
 * @param {string} args.circleId
 * @param {object} args.recipe                          a loaded recipe (`loadRecipe(...).recipe`)
 * @param {Array<{manifest:object}>} [args.sources]     merged manifest sources
 * @param {{ update:(id:string,patch:object)=>Promise<object> }} args.policyStore  the circle policy store
 * @returns {Promise<{ ok:true, policy:object, patch:object } | { ok:false, error:{code,message} }>}
 */
export async function applyRecipeToCircle({ circleId, recipe, sources = [], policyStore } = {}) {
  if (typeof circleId !== 'string' || circleId === '') {
    return { ok: false, error: { code: 'no-circle', message: 'circleId required' } };
  }
  if (!policyStore || typeof policyStore.update !== 'function') {
    return { ok: false, error: { code: 'no-store', message: 'policyStore with update() required' } };
  }
  const mapped = recipeToCirclePolicyPatch(recipe, { sources });
  if (mapped.error) return { ok: false, error: mapped.error };
  const policy = await policyStore.update(circleId, mapped.patch);
  // a store that states the settings to the circle answers `{ok: false}` when that did not go out: not applied
  if (policy && policy.ok === false) return { ok: false, error: { code: 'not-stated', message: 'the settings could not be sent to the circle' } };
  return { ok: true, policy, patch: mapped.patch };
}

/**
 * LOAD + APPLY — the shell-facing one-shot: load a recipe from a source (URL /
 * JSON string / object) via the shipped loader, then apply it. The shell injects
 * `fetch` (web/mobile own the network) + an optional `verify` (the deny-by-
 * default trust seam); everything else is the pure mapper. Keeps the load+apply
 * logic in shared `src/` so the shell stays a thin adapter (invariant #1).
 *
 * @param {object} args
 * @param {string|object} args.source     URL / JSON string / recipe object (loader's `source`)
 * @param {string} args.circleId
 * @param {Array<{manifest:object}>} [args.sources]  merged manifest sources
 * @param {object} args.policyStore
 * @param {Function} [args.fetch]         injected fetcher (loader trust/offline seam)
 * @param {Function} [args.verify]        injected trust check (deny-by-default)
 * @returns {Promise<{ ok:true, policy, patch, warnings:string[] } | { ok:false, error:{code,message} }>}
 */
export async function loadAndApplyRecipe({ source, circleId, sources = [], policyStore, fetch, verify } = {}) {
  const loaded = await loadRecipe(source, { fetch, verify });
  if (loaded.error) return { ok: false, error: loaded.error };
  const applied = await applyRecipeToCircle({ circleId, recipe: loaded.recipe, sources, policyStore });
  if (!applied.ok) return applied;
  return { ...applied, warnings: loaded.warnings ?? [] };
}
