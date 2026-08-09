/**
 * InterestProfileCache — Stoop V2 Phase 29.2 (2026-05-07).
 *
 * Persist a `InterestProfile` POJO through a `core.DataSource` with
 * a debounce so rapid-fire `update()` calls don't thrash the cache.
 *
 *   - `load({dataSource})`            — read the blob, return a fresh
 *                                       (or empty) profile.
 *   - `attach({profile, dataSource})` — install the `_onChange` hook
 *                                       so future `update()`s schedule
 *                                       a debounced save.  Returns a
 *                                       `detach` fn + a `flushNow` fn
 *                                       for tests / shutdown.
 *
 * Default debounce: 10 seconds (V2 plan).  Bigger than MemberMap's
 * because the profile churns per-message, not per-skill-call.
 *
 * Storage path: `mem://stoop/interest-profile.json`.
 */

import { createProfile } from './InterestProfile.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const PROFILE_PATH = 'mem://stoop/interest-profile.json';
// Parameter register (#36) — interest-profile save debounce (scope:device, kind:internal).
const DEFAULT_DEBOUNCE_MS = param({ key: 'stoop.interestProfileDebounceMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10_000 });

async function load({ dataSource } = {}) {
  if (!dataSource?.read) throw new TypeError('InterestProfileCache.load: dataSource required');
  let raw;
  try { raw = await dataSource.read(PROFILE_PATH); } catch { raw = null; }
  if (raw == null) return createProfile();
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      docFrequency: parsed?.docFrequency && typeof parsed.docFrequency === 'object' ? parsed.docFrequency : {},
      totalDocs:    typeof parsed?.totalDocs === 'number' ? parsed.totalDocs : 0,
      centroidTerm: parsed?.centroidTerm && typeof parsed.centroidTerm === 'object' ? parsed.centroidTerm : {},
      centroidNorm: null,    // recomputed on next score()
    };
  } catch {
    return createProfile();
  }
}

function attach({ profile, dataSource, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  if (!profile) throw new TypeError('InterestProfileCache.attach: profile required');
  if (!dataSource?.write) throw new TypeError('InterestProfileCache.attach: dataSource.write required');

  let timer = null;
  let detached = false;

  function persist() {
    const snap = {
      docFrequency: { ...profile.docFrequency },
      totalDocs:    profile.totalDocs,
      centroidTerm: { ...profile.centroidTerm },
    };
    void dataSource.write(PROFILE_PATH, JSON.stringify(snap)).catch(() => {});
  }

  function schedule() {
    if (detached) return;
    if (timer !== null) return;     // already scheduled
    timer = setTimeout(() => {
      timer = null;
      persist();
    }, debounceMs);
  }

  // Install the hook on the profile itself; `update()` calls it.
  profile._onChange = schedule;

  function detach() {
    detached = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (profile._onChange === schedule) delete profile._onChange;
  }

  function flushNow() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    persist();
  }

  return { detach, flushNow };
}

async function bootstrap(args) {
  const profile = await load(args);
  const { detach, flushNow } = attach({ ...args, profile });
  return { profile, detach, flushNow };
}

export const InterestProfileCache = Object.freeze({ load, attach, bootstrap });
export const INTEREST_PROFILE_STORAGE_PATH = PROFILE_PATH;
