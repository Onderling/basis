/**
 * availabilityMigration — one-time, silent seed of the UNIFIED person-level
 * `availability` property on the root persona from the MOST-RESTRICTIVE existing
 * signal (availability unification, plans/NOTE-skills-properties-audit.md §4/§5,
 * decision). Backwards compatibility is dropped, so this is deliberately
 * trivial: seed once, guarded by a marker, then never touch the old signals again.
 *
 * Most-restrictive seeding: `holidayMode:true` OR any roster skill still carrying a
 * non-empty legacy `availability` sub-field → 'away'; otherwise 'open'. (Once the
 * per-skill field is dropped from MemberMap the skill signal is empty in practice,
 * leaving holidayMode as the effective input — which is exactly the fold-in intent.)
 *
 * Marker: `_migrations.availability` on the default profile (mirrors
 * skillsMigration's `_migrations.skillsRoster`). Not a charter key and not a
 * driver value, so no surface renders it. Set once → all re-runs are no-ops.
 */

import { AVAILABILITY_AWAY } from '@onderling/agent-registry';

/** Marker property on the default profile: 'done' once availability has been seeded. */
export const AVAILABILITY_MIGRATION_KEY = '_migrations.availability';

const unwrap = (v) => (v && typeof v === 'object' && 'mode' in v ? v.value : v);

/**
 * Seed the default profile's `availability` from the most-restrictive existing
 * signal, once. Safe to call on every Mij load — the marker makes repeats free.
 *
 * @param {object} args
 * @param {(origin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {string} [args.defaultId='default'] the root persona id
 * @returns {Promise<{ok: boolean, seeded?: string, already?: boolean, reason?: string}>}
 */
export async function migrateAvailability({ callSkill, defaultId = 'default' } = {}) {
  if (typeof callSkill !== 'function') return { ok: false, reason: 'no-callskill' };

  // marker — already seeded?
  let props = null;
  try { props = await callSkill('agents', 'getProfileProperties', { id: defaultId }); } catch { /* */ }
  if (!props || props.ok === false) return { ok: false, reason: 'no-profile' };
  if (unwrap(props?.properties?.[AVAILABILITY_MIGRATION_KEY])) return { ok: true, already: true };

  // most-restrictive existing signal → 'away' vs 'open'
  let away = false;
  try {
    const hm = await callSkill('pinboard', 'getHolidayMode', {});
    if (hm?.holidayMode === true) away = true;
  } catch { /* */ }
  if (!away) {
    try {
      const r = await callSkill('pinboard', 'listMyOfferings', {});
      const skills = Array.isArray(r?.skills) ? r.skills : [];
      // any legacy per-skill availability that meant "not fully open"
      if (skills.some((s) => s?.availability != null && s.availability !== '' && s.availability !== 'open')) away = true;
    } catch { /* */ }
  }
  const state = away ? AVAILABILITY_AWAY : 'open';

  try {
    const res = await callSkill('agents', 'setProfileProperty', { id: defaultId, key: 'availability', value: state });
    if (res?.ok === false) return { ok: false, reason: 'set-failed' };
  } catch { return { ok: false, reason: 'set-failed' }; }

  // mark done (only after the seed persisted) so re-runs are free
  try {
    await callSkill('agents', 'setProfileProperty', { id: defaultId, key: AVAILABILITY_MIGRATION_KEY, value: 'done' });
  } catch { /* */ }

  return { ok: true, seeded: state };
}
