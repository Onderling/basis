/**
 * locationMigration — one-time, silent seed of the person-level `location` property on the
 * root persona from the bespoke pinboard `profile.location {cell,label,source}` field (location
 * fold-in, plans/NOTE-skills-properties-audit.md §4; personal-properties design §2). Mirrors
 * availabilityMigration.js: seed once, guarded by a marker, then never touch the old field.
 *
 * Most-restrictive seeding: the bespoke pinboard location is ALREADY coarse (a grid `cell` + a
 * human `label`, no raw coords), so we seed the COARSE LABEL token — never coordinates. When
 * there is no bespoke location, nothing is seeded (the property stays ∅) but the marker is
 * still set, so this stays a genuine one-time migration.
 *
 * Marker: `_migrations.location` on the default profile (mirrors availabilityMigration's
 * `_migrations.availability`). Not a charter key and not a driver value, so no surface renders
 * it. Set once → all re-runs are no-ops.
 */

import { isLocationValue, locationLabel } from '@onderling/agent-registry';

/** Marker property on the default profile: 'done' once location has been seeded. */
export const LOCATION_MIGRATION_KEY = '_migrations.location';

const unwrap = (v) => (v && typeof v === 'object' && 'mode' in v ? v.value : v);

/**
 * Seed the default profile's `location` from the bespoke pinboard location, once. Safe to call
 * on every Mij load — the marker makes repeats free.
 *
 * @param {object} args
 * @param {(origin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {string} [args.defaultId='default'] the root persona id
 * @returns {Promise<{ok: boolean, seeded?: string, skipped?: boolean, already?: boolean, reason?: string}>}
 */
export async function migrateLocation({ callSkill, defaultId = 'default' } = {}) {
  if (typeof callSkill !== 'function') return { ok: false, reason: 'no-callskill' };

  // marker — already seeded?
  let props = null;
  try { props = await callSkill('agents', 'getProfileProperties', { id: defaultId }); } catch { /* */ }
  if (!props || props.ok === false) return { ok: false, reason: 'no-profile' };
  if (unwrap(props?.properties?.[LOCATION_MIGRATION_KEY])) return { ok: true, already: true };

  // Source: the bespoke pinboard coarse location {cell,label,source}. Seed the COARSE label
  // token (most-restrictive: never raw coords — the pinboard field is already coarse).
  let seedValue = null;
  try {
    const r = await callSkill('pinboard', 'getMyLocation', {});
    const loc = r?.location ?? null;
    if (isLocationValue(loc)) seedValue = locationLabel(loc);
  } catch { /* */ }

  if (seedValue != null) {
    try {
      const res = await callSkill('agents', 'setProfileProperty', { id: defaultId, key: 'location', value: seedValue });
      if (res?.ok === false) return { ok: false, reason: 'set-failed' };
    } catch { return { ok: false, reason: 'set-failed' }; }
  }

  // mark done (only after any seed persisted) so re-runs are free
  try {
    await callSkill('agents', 'setProfileProperty', { id: defaultId, key: LOCATION_MIGRATION_KEY, value: 'done' });
  } catch { /* */ }

  return seedValue != null ? { ok: true, seeded: seedValue } : { ok: true, skipped: true };
}
