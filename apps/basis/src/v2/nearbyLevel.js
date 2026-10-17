/**
 * WHAT THE NEARBY ROOM SEES OF A SELF — its LEVEL: `none` (nothing: no face, no card), `handle` (the floor — the
 * pseudonym), `profile` (the presented self), `full`. It lives on THAT self's disclosure under the reserved context
 * `nearby` — the person's, not the device's, so it travels with the persona — written by one op (`setNearbyLevel`) and
 * read by `nearbyLevelFrom`. The preset keys carry the release itself (what `releasedValues(self, 'nearby')` returns);
 * the level is also kept explicitly on a marker entry (`full` cannot be told from `profile` by its keys alone, and
 * `none` by none). Nothing set → `handle` (default-strict).
 */
import { REVEAL_PRESETS } from '@onderling/agent-registry';
import { presetFromDisclosure } from './contactLens.js';
import { personaPresetKeys, revealPresetLabelKey } from './memberCards.js';

/** The reserved disclosure context of the Nearby room (one writer: `setNearbyLevel`). */
export const NEARBY_CONTEXT = 'nearby';
/** The levels, least first. */
export const NEARBY_LEVELS = Object.freeze(['none', ...REVEAL_PRESETS]);
/** The marker entry that keeps the level itself (a marker key: never released, matched or shown). */
export const NEARBY_LEVEL_KEY = '_nearby.level';

/**
 * A self's Nearby level from its disclosure policy.
 * @param {{perContext?: Record<string, Record<string, object>>}|null} disclosure
 * @returns {'none'|'handle'|'profile'|'full'}
 */
export function nearbyLevelFrom(disclosure) {
  const ctx = disclosure?.perContext?.[NEARBY_CONTEXT];
  if (!ctx) return 'handle';
  const kept = ctx[NEARBY_LEVEL_KEY];
  if (kept && kept.enabled === false) return 'none';
  if (NEARBY_LEVELS.includes(kept?.rung)) return kept.rung;
  return presetFromDisclosure(ctx);
}

/**
 * The disclosure writes that set a level: every preset tier's keys on or off (cumulative, as a join's reveal), and the
 * marker entry that keeps the level.
 * @param {string} level
 * @returns {Array<{key: string, enabled: boolean, rung?: string}>|null}  null for an unknown level
 */
export function nearbyLevelWrites(level) {
  if (!NEARBY_LEVELS.includes(level)) return null;
  const upTo = REVEAL_PRESETS.indexOf(level);   // -1 for none: every tier off
  const out = [];
  const seen = new Set();
  REVEAL_PRESETS.forEach((p, i) => {
    for (const key of personaPresetKeys(p)) {
      if (typeof key !== 'string' || !key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, enabled: i <= upTo });
    }
  });
  out.push({ key: NEARBY_LEVEL_KEY, enabled: level !== 'none', rung: level });
  return out;
}

/** The word a level shows by: `none` is the room's own "Nobody"; the others are the reveal presets' words. */
export function nearbyLevelLabelKey(level) {
  return level === 'none' ? 'circle.nearbyScreen.face_none' : revealPresetLabelKey(level);
}
