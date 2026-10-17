// location — a first-class, disclosure-controlled PLACE property with the design's
// CANONICAL coarseness ladder (plans/NOTE-personal-properties-and-disclosure.md §2). It
// folds in the bespoke pinboard `profile.location {cell,label,source}` field (a per-circle
// MemberMap geo attribute) as ONE person-level property on the profile graph, governed by
// the SAME disclosure policy as every other property — mirroring the availability fold-in
// (availability.js, decision; audit 4 flagged location as the STRONG next candidate).
//
// Ladder (design's canonical example), COARSEST→finest (propertyVocabulary convention):
//   in-area(y/n) → region → municipality → district → coords
// with the implicit ∅ below `in-area` (disclosure withholds the key entirely). `in-area`
// is a PREDICATE — the coarsest useful rung — leaking no raw place, only "is this person in
// the area?" yes/no. `coords` (finest) releases the whole stored value incl. any raw coords.
// coarsen() FAILS CLOSED: raw coords leave ONLY at the `coords` rung; every coarser rung
// releases a coarse label (never coordinates); a null/unknown rung collapses to the in-area
// predicate, never revealing more than asked.
//
// PRAGMATIC value model (mirrors availability's plain token): the stored value is a COARSE
// place TOKEN — a label string, OR a small object `{ label?, cell?, coords?, district?,
// municipality?, region? }`. The store keeps it opaque; this module owns the shape.
//
// TODO(geo-coarsening): true per-rung geo REDUCTION (raw coords → district → municipality →
// region via reverse geocoding) is heavy and NOT done here — today every named coarse rung
// releases the stored coarse label as-is (already coarse, e.g. a geocoder municipality
// label); only the `coords` (release whole) and `in-area` (predicate) extremes are
// semantically distinct. Wire a reverse-geocoder into labelAtRung() when finer ladder
// fidelity is needed.
//
// Pure — web ≡ mobile, no I/O. Like drivers.js / availability.js.

import { descriptor } from './propertyVocabulary.js';

/**
 * The location coarseness ladder, COARSEST→finest (propertyVocabulary convention):
 * `in-area` (a y/n predicate) → `region` → `municipality` → `district` → `coords` (the whole
 * value). Below `in-area` sits the implicit ∅ — disclosure withholds the key entirely.
 */
export const LOCATION_LADDER = Object.freeze(['in-area', 'region', 'municipality', 'district', 'coords']);

/** The coarsest predicate rung — leaks no raw place, just in-area yes/no (the design's `in-area(y/n)`). */
export const LOCATION_IN_AREA = 'in-area';

/** Named coarse place fields, FINEST→coarsest (used to pick a coarse label; `coords` excluded). */
const NAMED_RUNGS = Object.freeze(['district', 'municipality', 'region']);

/** True iff `v` is a usable location value (a non-empty label string or a location object). */
export function isLocationValue(v) {
  if (typeof v === 'string') return v.length > 0;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (typeof v.label === 'string' && v.label.length > 0) return true;
    if (typeof v.cell === 'string' && v.cell.length > 0) return true;
    if (NAMED_RUNGS.some((r) => typeof v[r] === 'string' && v[r].length > 0)) return true;
    if (v.coords && typeof v.coords === 'object') return true;
  }
  return false;
}

/**
 * The coarse DISPLAY/label token for a location value (a place NAME), NEVER raw coords.
 * Prefers the coarsest named field, then a generic label/cell. `null` when nothing usable
 * (e.g. a value carrying only raw coords — no human place name to show).
 *
 * @param {string|{label?:string,cell?:string,district?:string,municipality?:string,region?:string}} value
 * @returns {string|null}
 */
export function locationLabel(value) {
  if (typeof value === 'string') return value.length ? value : null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of ['region', 'municipality', 'district']) {
      if (typeof value[r] === 'string' && value[r].length) return value[r];
    }
    if (typeof value.label === 'string' && value.label.length) return value.label;
    if (typeof value.cell === 'string' && value.cell.length) return value.cell;
  }
  return null;
}

/** The in-area PREDICATE: true iff a location is present (the coarsest, place-free rung). */
export function inArea(value) {
  return isLocationValue(value);
}

/**
 * A coarse label at `rung` or coarser — never finer than a place name, never raw coords.
 * TODO(geo-coarsening): today this collapses all named rungs to the stored coarse label;
 * a real reverse-geocoder would resolve the exact rung field from raw coords.
 */
function labelAtRung(value, rung) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const start = NAMED_RUNGS.indexOf(rung);            // district=0, municipality=1, region=2
    const chain = start >= 0 ? NAMED_RUNGS.slice(start) : NAMED_RUNGS;
    for (const r of chain) if (typeof value[r] === 'string' && value[r].length) return value[r];
  }
  return locationLabel(value);
}

/**
 * The property-vocabulary descriptor for the location key. Type `coarse-enum` (like
 * place/availability), ladder `in-area → region → municipality → district → coords`.
 * Coarsening is FAIL-CLOSED:
 *   • `coords` (finest) — releases the whole stored value, incl. any raw coordinates.
 *   • a named coarse rung (district/municipality/region) — a coarse place label, NEVER coords.
 *   • `in-area` (coarsest) — and any null/unknown rung — the y/n predicate only.
 * `sensitive` (location + possessions + availability is the burglary vector).
 *
 * @param {string} [key='location']
 */
export function locationDescriptor(key = 'location') {
  return descriptor({
    key,
    type: 'coarse-enum',
    ladder: LOCATION_LADDER,
    sensitivity: 'sensitive',
    coarsen: (value, rung) => {
      if (value == null) return null;
      // 'coords' (finest) releases the whole stored value, incl. any raw coordinates.
      if (rung === 'coords') return value;
      // 'in-area' (coarsest) — and any null/unknown rung — fail-closed to the predicate.
      if (rung === LOCATION_IN_AREA || !LOCATION_LADDER.includes(rung)) return inArea(value);
      // a named coarse rung (district/municipality/region): a coarse label, NEVER coords.
      return labelAtRung(value, rung);
    },
  });
}
