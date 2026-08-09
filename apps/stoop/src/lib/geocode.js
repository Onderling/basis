/**
 * geocode.js — Stoop V2 Phase 26.2 (2026-05-07).
 *
 * Place-name → coarse cell via OpenStreetMap Nominatim.  Open API,
 * no key required.  Per Nominatim's policy the Stoop app rate-limits
 * to 1 request/sec per process and sets a User-Agent identifying
 * the app.
 *
 * Tests inject a stub HTTP factory via `_setHttpFactory`.
 */

import { cellFor } from './geo.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT     = 'Stoop/0.2 (https://github.com/Onderling)';

let _httpFactory = null;
let _lastCallAt  = 0;
// Parameter register (#36) — Nominatim rate-limit interval (scope:device, kind:internal).
const RATE_LIMIT_MS = param({ key: 'stoop.geocodeRateLimitMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1000 });

/** Test seam: replace the fetch implementation. */
export function _setHttpFactory(factory) {
  _httpFactory = factory;
}

async function defaultFetch(url, init = {}) {
  return fetch(url, init);
}

async function getFetch() {
  return _httpFactory ?? defaultFetch;
}

/**
 * Geocode a free-text query (place name, postcode, address) to a
 * coarse-grain cell + a human-readable label.
 *
 * @param {object} args
 * @param {string} args.query
 * @param {number} [args.gridM=500]
 * @returns {Promise<{cell: string, label: string, source: 'geocode', raw: {lat: number, lng: number}} | {error: string}>}
 */
export async function geocode({ query, gridM = 500 } = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    return { error: 'query required' };
  }

  // Rate-limit: Nominatim policy is 1 req/sec absolute.
  const now = Date.now();
  const wait = _lastCallAt + RATE_LIMIT_MS - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallAt = Date.now();

  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const fetchFn = await getFetch();
  let res;
  try {
    res = await fetchFn(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
  } catch (err) {
    return { error: `network: ${err?.message ?? String(err)}` };
  }
  if (!res?.ok) return { error: `status: ${res?.status ?? '?'}` };
  let body;
  try { body = await res.json(); } catch (err) { return { error: `json: ${err.message ?? err}` }; }
  if (!Array.isArray(body) || body.length === 0) return { error: 'no-result' };

  const hit = body[0];
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'malformed-coords' };

  return {
    cell:   cellFor({ lat, lng, gridM }),
    label:  hit.display_name ?? query,
    source: 'geocode',
    raw:    { lat, lng },
  };
}
