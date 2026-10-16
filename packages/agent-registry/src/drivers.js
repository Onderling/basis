// Personal drivers — the `driver` property type (property layer §12 / plans note
// `personal-drivers-matching`). A driver is an OPT-IN, deeply personal property: what someone is
// trying to do or cares about, BEYOND offerings (a hobby, goal, desire, motivation). It is just
// another property on the profile graph, so per-persona / per-circle disclosure comes for free
// from the existing disclosure policy — the value here is only the SHAPE + validation.
//
// Deliberately OPEN / semantic, NOT coarse buckets (contrast coarse-enum place/ageBand): a driver
// is a short human phrase + normalized tags. That shape keeps BOTH matching paths open —
// deterministic tag-overlap AND an optional LLM re-rank — while every surfaced match stays
// explainable ("you both care about: sailing, learning"), never a raw opaque score.
//
// Pure — web ≡ mobile, no I/O. The STORE keeps the value opaque; this module is the only place
// that knows a driver's internal shape.

import { descriptor } from './propertyVocabulary.js';
import { effectiveProperties } from './profileProperties.js';

/**
 * The kinds of personal driver. `driver` is the generic catch-all; the rest are finer intents.
 * `offering` (offering→property fold-in, NOTE-skills-properties-audit) is a driver-LIKE open
 * item — what someone can DO/offer rather than wants — sharing the `{ kind, text, tags[] }` shape;
 * its coarse rung (categoryId under disclosure) lives in `offeringsTaxonomy.js`, not here.
 *
 * `interest` (interests→drivers fold-in, NOTE-skills-properties-audit 4) is likewise a
 * driver-kind open item — what someone ENGAGES WITH / cares about — carried as tags on the
 * `{ kind, text, tags[] }` shape (no taxonomy / coarse rung: interests are FREE drivers, matched
 * on-device by tag overlap). It folds the bespoke learned Layer-2 interest signal
 * (stoop InterestProfile top terms) into one disclosure-controlled property on the profile graph.
 *
 * Legacy `skill` (the pre-rename name for the human "I can do X" DATA — see
 * NOTE-offering-rename-inventory.md) is READ-ACCEPTED and normalized to `offering`; new writes use
 * `offering`. The INVOCABLE A2A sense keeps the word "skill" elsewhere and is unrelated here.
 */
export const DRIVER_KINDS = Object.freeze(['hobby', 'goal', 'desire', 'motivation', 'driver', 'offering', 'interest']);

/** Back-compat: legacy driver-kind values normalized to the current name (`skill` → `offering`). */
const LEGACY_KIND_ALIASES = Object.freeze({ skill: 'offering' });

/** Normalize a stored/legacy driver-kind string to its current name. */
export function normalizeDriverKind(k) {
  return (typeof k === 'string' && LEGACY_KIND_ALIASES[k]) || k;
}

/** True iff `k` is a DRIVER_KINDS string (or a read-accepted legacy alias, e.g. `skill`). */
export function isDriverKind(k) {
  return typeof k === 'string' && (DRIVER_KINDS.includes(k) || k in LEGACY_KIND_ALIASES);
}

/**
 * Normalise one tag: lowercased, trimmed, internal whitespace/underscores → single hyphens,
 * stripped of anything but [a-z0-9-]. Returns '' for junk (callers drop empties). Keeps the tag
 * vocabulary clean so tag-overlap matching is stable across authors.
 */
export function normalizeTag(t) {
  return String(t ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Normalise + de-duplicate a tag list, preserving first-seen order. */
export function normalizeTags(tags) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(tags) ? tags : []) {
    const n = normalizeTag(raw);
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

/**
 * Build a validated, frozen driver value: `{ kind, text, tags[] }` (+ `categoryId` for offerings).
 * - `kind` falls back to the generic `driver` when unknown.
 * - `text` is a trimmed human phrase (may be empty when tags carry the meaning).
 * - `tags` are normalised + de-duped.
 * - `categoryId` (offering kind only): the user-picked taxonomy bucket — the coarse
 *   rung `offeringDescriptor`'s coarsen() honours over derivation. Dropped for
 *   other kinds (they have no coarse rung).
 * - legacy `kind:'skill'` is normalized to `offering` (read-compat).
 * A driver with neither text NOR tags is meaningless — throws (nothing to disclose or match on).
 *
 * @param {{kind?:string, text?:string, tags?:string[], categoryId?:string}} d
 * @returns {{kind:string, text:string, tags:string[], categoryId?:string}}
 */
export function createDriver({ kind = 'driver', text = '', tags = [], categoryId } = {}) {
  const k = isDriverKind(kind) ? normalizeDriverKind(kind) : 'driver';
  const t = String(text ?? '').trim();
  const tg = normalizeTags(tags);
  if (!t && tg.length === 0) {
    throw new TypeError('createDriver: a driver needs at least text or one tag');
  }
  const out = { kind: k, text: t, tags: Object.freeze(tg) };
  if (k === 'offering' && typeof categoryId === 'string' && categoryId.trim()) {
    out.categoryId = categoryId.trim();
  }
  return Object.freeze(out);
}

/**
 * Shape guard for an opaque stored property value — true iff `v` is a well-formed driver value.
 * The property store keeps values opaque, so consumers use this to know "is this key a driver?".
 */
export function isDriverValue(v) {
  return !!v
    && typeof v === 'object'
    && !Array.isArray(v)
    && isDriverKind(v.kind)
    && typeof v.text === 'string'
    && Array.isArray(v.tags)
    && v.tags.every((x) => typeof x === 'string')
    && (v.text.length > 0 || v.tags.length > 0);
}

/**
 * A property-vocabulary descriptor for a driver key. Type `driver`, `sensitive` (drivers are
 * personal), and NO coarseness ladder — a driver is all-or-nothing per context (you share the
 * whole driver or none of it; there is no "coarser" driver), unlike a coarse-enum attribute.
 *
 * @param {string} key
 */
export function driverDescriptor(key) {
  return descriptor({ key, type: 'driver', ladder: null, coarsen: null, sensitivity: 'sensitive' });
}

/**
 * Extract the DRIVER properties out of a full profile property map — a profile's `properties` holds
 * every kind (coarse-enum place/ageBand alongside drivers), so the matcher needs just the drivers.
 * Returns a `{ key → driverValue }` map, keeping only well-formed driver values (isDriverValue).
 *
 * @param {Record<string, any>} properties
 * @returns {Record<string, {kind:string,text:string,tags:string[]}>}
 */
export function driversFromProperties(properties) {
  const out = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (isDriverValue(value)) out[key] = value;
  }
  return out;
}

/**
 * A profile's effective DRIVER values: what it inherits and what it has of its own. The stop on the general offerings
 * (`OFFERINGS_INHERIT_KEY`) lives where inheritance is resolved (`resolveProperty`), so this is a thin read over it.
 * @param {(id: string) => object|null} getProfile
 * @param {string} profileId
 * @param {{defaultProfileId?: string}} [opts]
 * @returns {Record<string, object>}
 */
export function effectiveDrivers(getProfile, profileId, opts = {}) {
  return driversFromProperties(effectiveProperties(getProfile, profileId, opts));
}

