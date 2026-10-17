/**
 * freedom — the admin FREEDOM TEMPLATE over (verb × noun) capabilities (B, ruling).
 *
 * The creation wizard's last step lets the admin decide, PER capability, whether members may use it
 * (`enabled`), whether it's `required` or `optional` for them, and the `consequence` of opting out
 * (greyed [default] / hidden / limited). A hard PRIVACY FLOOR marks capabilities that are ALWAYS
 * opt-outable (location, real-name reveal, DMs-from-strangers, being-assignable) — those can never be
 * set `required`.
 *
 * The template is partial: any capability the admin didn't touch takes DEFAULT_ROW (enabled, optional,
 * greyed) — default-on migration (ruling). `buildCapabilityMatrix` is what the wizard renders;
 * `effectiveCapabilityKeys` is the narrowed set the Slice-1 gate authorises — this is where the gate
 * finally drops BELOW app-level (an admin can disable `pinboard add post` without disabling all of pinboard).
 */

import { capabilitiesOf, capabilityKey } from './capabilities.js';

/** Whether a member MUST use a capability or MAY opt out (ruling). */
export const FREEDOM_LEVELS = Object.freeze(['required', 'optional']);
/** What happens in the UI when a member opts out of an optional capability (ruling). */
export const OPT_OUT_CONSEQUENCES = Object.freeze(['greyed', 'hidden', 'limited']);

/** The freedom row for a capability the admin template says nothing about (default-on). */
export const DEFAULT_ROW = Object.freeze({ enabled: true, freedom: 'optional', consequence: 'greyed', privacyFloor: false });

/** The apps in play — `enabledApps` (a Set|array|null); null ⇒ every app in `sources`. */
function isAppEnabled(app, enabledApps) {
  if (enabledApps == null) return true;
  const set = enabledApps instanceof Set ? enabledApps : new Set(enabledApps);
  return set.has(app);
}

/**
 * Merge a template entry over DEFAULT_ROW, enforcing the privacy floor (a floored capability can't be
 * `required`). Unknown freedom/consequence values fall back to the default.
 */
function resolveRow(entry = {}) {
  const privacyFloor = !!entry.privacyFloor;
  let freedom = FREEDOM_LEVELS.includes(entry.freedom) ? entry.freedom : DEFAULT_ROW.freedom;
  if (privacyFloor) freedom = 'optional';                                   // floor wins — never required
  const consequence = OPT_OUT_CONSEQUENCES.includes(entry.consequence) ? entry.consequence : DEFAULT_ROW.consequence;
  const enabled = entry.enabled === undefined ? DEFAULT_ROW.enabled : !!entry.enabled;
  return { enabled, freedom, consequence, privacyFloor };
}

/** Coerce `optOuts` (Set|array|undefined) to a Set of keys. */
function toSet(optOuts) {
  if (optOuts instanceof Set) return optOuts;
  return new Set(Array.isArray(optOuts) ? optOuts : []);
}

/**
 * The full per-capability matrix the wizard renders: one row per (app × atom × noun) capability of the
 * ENABLED apps, merged with the admin `template`. Rows carry the resolved freedom/consequence + the
 * implementing `opId` (or null = declared-but-unimplemented), plus (B) whether a member may
 * opt out (`optOutable` = freedom 'optional' OR a privacy floor) and whether THIS member has (`optedOut`).
 *
 * @param {Array<{manifest:object}>} sources
 * @param {object} [opts]
 * @param {Set<string>|string[]|null} [opts.enabledApps]  apps enabled in the circle (null = all)
 * @param {object} [opts.template]  `{ "<app> <atom> <noun>": { enabled?, freedom?, consequence?, privacyFloor? } }`
 * @param {Set<string>|string[]} [opts.optOuts] the member's opted-out capability keys
 * @returns {Array<{key,app,atom,noun,opId,enabled,freedom,consequence,privacyFloor,optOutable,optedOut}>}
 */
export function buildCapabilityMatrix(sources, { enabledApps = null, template = {}, optOuts } = {}) {
  const rows = [];
  const tmpl = (template && typeof template === 'object') ? template : {};
  const out = toSet(optOuts);
  for (const src of (Array.isArray(sources) ? sources : [])) {
    const manifest = src?.manifest;
    const app = manifest?.app;
    if (!app || !isAppEnabled(app, enabledApps)) continue;
    for (const cap of capabilitiesOf(manifest)) {
      const key = capabilityKey(app, cap.atom, cap.noun);
      const row = { key, app, atom: cap.atom, noun: cap.noun, opId: cap.opId, ...resolveRow(tmpl[key]) };
      row.optOutable = row.freedom === 'optional' || row.privacyFloor;   // a member MAY decline these
      row.optedOut = row.optOutable && out.has(key);                     // …and THIS member has
      rows.push(row);
    }
  }
  return rows;
}

/**
 * The narrowed capability KEY SET the gate authorises = admin-template ∩ (not member opt-outs).
 * A cap is authorised iff its matrix row is `enabled` (admin didn't disable it) AND the member hasn't
 * opted out of it (only opt-outable caps can be opted out). No `optOuts` ⇒ pure admin template (Slices 1–2).
 * @returns {Set<string>}
 */
export function effectiveCapabilityKeys(sources, opts = {}) {
  const keys = new Set();
  for (const row of buildCapabilityMatrix(sources, opts)) {
    if (row.enabled && !row.optedOut) keys.add(row.key);
  }
  return keys;
}

/**
 * B · (ruling) — how an AFFORDANCE for a capability should render for this member, given a
 * pre-built matrix (`buildCapabilityMatrix` with the member's `optOuts`). An authorised cap renders
 * normally (`'show'`); a disabled-or-opted-out cap applies the admin's consequence:
 *   greyed → `'grey'` (show but disabled) · hidden → `'hide'` (omit) · limited → `'limit'`.
 * A cap not in the matrix (domain verb / not gated) → `'show'`. Pure; surfaces map the result to UI.
 *
 * @param {Array} matrix  from buildCapabilityMatrix({..., optOuts})
 * @param {{app:string, atom:string, noun:string}} cap
 * @returns {'show'|'grey'|'hide'|'limit'}
 */
export function affordanceTreatment(matrix, { app, atom, noun } = {}) {
  if (!atom) return 'show';
  const row = (Array.isArray(matrix) ? matrix : []).find((r) => r.app === app && r.atom === atom && r.noun === noun);
  if (!row) return 'show';                           // not a gated capability
  if (row.enabled && !row.optedOut) return 'show';   // authorised → normal
  return row.consequence === 'hidden' ? 'hide' : row.consequence === 'limited' ? 'limit' : 'grey';
}
