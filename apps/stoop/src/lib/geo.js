/**
 * geo.js — Stoop V2 Phase 26 (2026-05-07).
 *
 * Coarse-grain geo-grid + filter primitives.  Pure functions; no I/O.
 *
 * Cell encoding: `<gridM>:<row>:<col>` strings — a deterministic hash
 * of coordinates rounded to the chosen grid size.  Two devices with
 * the same coords + grid produce the same cell string.  Distance
 * between cells is the great-circle distance between their centers.
 *
 * Default grid: 500m.  `maxDistanceKm` snaps to a small preset list
 * so the post composer doesn't expose finer granularity than the
 * grid warrants.
 *
 * **Substrate candidate** (rule of two — first consumer): when a
 * 2nd app wants distance-filtered fan-out, lift this into
 * `@onderling/geo-grid`.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const EARTH_R_KM = 6371;
// Parameter register (#36) — default coarse geo-grid size in metres (scope:device, kind:internal).
const DEFAULT_GRID_M = param({ key: 'stoop.gridM', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 500 });

/**
 * Compute the cell string for a (lat, lng) pair at a given grid.
 *
 * Cell row/col come from the rounded lat/lng in degrees-to-grid units:
 *   row = round(lat * (1 deg lat ≈ 111 km) * 1000 / gridM)
 *   col = round(lng * cos(lat) * 111000 / gridM)
 *
 * The `cos(lat)` correction at `col` keeps cells roughly square at any
 * latitude; absent it, cells get visually stretched east-west near the
 * equator.  We use `cos(lat)` evaluated at row-center to preserve
 * commutativity of `cellFor → distanceKm`.
 *
 * @param {object} args
 * @param {number} args.lat       in degrees, -90..90
 * @param {number} args.lng       in degrees, -180..180
 * @param {number} [args.gridM=500]   grid size in metres
 * @returns {string}              cell encoding
 */
export function cellFor({ lat, lng, gridM = DEFAULT_GRID_M } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new TypeError('cellFor: lat + lng (numbers) required');
  }
  if (lat < -90 || lat > 90) throw new RangeError('cellFor: lat out of range');
  if (lng < -180 || lng > 180) throw new RangeError('cellFor: lng out of range');

  const m  = Math.max(50, Math.floor(gridM));
  const latM = (lat * 111_000);                            // metres-from-equator
  const cosLat = Math.cos(lat * Math.PI / 180);
  const lngM = (lng * 111_000 * cosLat);                   // east-of-prime-meridian
  const row = Math.round(latM / m);
  const col = Math.round(lngM / m);
  return `${m}:${row}:${col}`;
}

/**
 * Decode a cell string back to its (approximate) center coordinates.
 * Inverse of `cellFor` (lossy — coords land at cell-center).
 *
 * @param {string} cell
 * @returns {{lat: number, lng: number, gridM: number}}
 */
export function cellCenter(cell) {
  if (typeof cell !== 'string') throw new TypeError('cellCenter: cell string required');
  const parts = cell.split(':');
  if (parts.length !== 3) throw new TypeError(`cellCenter: malformed cell '${cell}'`);
  const [gridM, row, col] = parts.map(Number);
  if (!Number.isFinite(gridM) || !Number.isFinite(row) || !Number.isFinite(col)) {
    throw new TypeError(`cellCenter: malformed cell '${cell}'`);
  }
  const lat = (row * gridM) / 111_000;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const lng = cosLat === 0 ? 0 : (col * gridM) / (111_000 * cosLat);
  return { lat, lng, gridM };
}

/**
 * Great-circle distance between two cell centers, in kilometres.
 *
 * @param {string} cellA
 * @param {string} cellB
 * @returns {number}    km, rounded to 0.1
 */
export function distanceKm(cellA, cellB) {
  if (cellA === cellB) return 0;
  const a = cellCenter(cellA);
  const b = cellCenter(cellB);
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  const km = EARTH_R_KM * c;
  return Math.round(km * 10) / 10;
}

/** Preset distances offered by the post composer.  In kilometres. */
export const DISTANCE_PRESETS = Object.freeze([1, 2, 5, 10, 25]);

/**
 * Snap an arbitrary km value to the nearest preset.  Below the
 * smallest preset → smallest preset; above the largest → largest.
 *
 * @param {number} km
 * @returns {number}
 */
export function snapToGrid(km) {
  if (!Number.isFinite(km)) return DISTANCE_PRESETS[0];
  if (km <= DISTANCE_PRESETS[0]) return DISTANCE_PRESETS[0];
  if (km >= DISTANCE_PRESETS[DISTANCE_PRESETS.length - 1]) {
    return DISTANCE_PRESETS[DISTANCE_PRESETS.length - 1];
  }
  // Find the closest preset.
  let best = DISTANCE_PRESETS[0];
  let bestDiff = Math.abs(km - best);
  for (const p of DISTANCE_PRESETS) {
    const d = Math.abs(km - p);
    if (d < bestDiff) { best = p; bestDiff = d; }
  }
  return best;
}

/**
 * V3 mobile entry point — get the user's current coarse location
 * via GPS.  Web stub throws; RN binds via expo-location.
 *
 * @returns {Promise<{cell: string, label: string|null, source: 'gps'}>}
 */
// eslint-disable-next-line no-unused-vars
export async function getCoarseLocationFromGps({ gridM = DEFAULT_GRID_M } = {}) {
  throw new Error('getCoarseLocationFromGps: V3 mobile only — not available on web');
}

export const GEO_DEFAULTS = Object.freeze({
  gridM: DEFAULT_GRID_M,
  presets: DISTANCE_PRESETS,
});
