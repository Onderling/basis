/**
 * interestsMigration — one-time, silent seed of a person-level `interests` DRIVER on the root
 * persona from the bespoke learned interest signal (interests→drivers fold-in,
 * plans/NOTE-skills-properties-audit.md §4/). Mirrors locationMigration.js /
 * availabilityMigration.js: seed once, guarded by a marker, then never touch the old signal.
 *
 * Source: the stoop Layer-2 `getInterestProfile` snapshot — a TF-IDF profile learned from the
 * bodies the user engaged with, exposed as `{ totalDocs, topTerms: [{term, weight}] }`. There is
 * NO user-declared interests list today; this learned bag-of-terms IS the current representation.
 * The audit decided interests are a driver KIND that "overlaps drivers tags" (§4), so we fold the
 * top terms into ONE `interest`-kind driver whose TAGS carry the meaning (text empty) — a free
 * driver, no taxonomy / coarse rung, matched on-device by tag overlap like every other driver.
 *
 * Most-restrictive seeding: only the strongest handful of terms (the signal, not the whole
 * vocabulary), normalised to tags by createDriver on the write path. When there are no terms
 * nothing is seeded (the property stays ∅) but the marker is still set, so this stays a genuine
 * one-time migration.
 *
 * Marker: `_migrations.interests` on the default profile (mirrors locationMigration's
 * `_migrations.location`). Not a charter key and not a driver value, so no surface renders it.
 * Set once → all re-runs are no-ops.
 */

/** Marker property on the default profile: 'done' once interests have been seeded. */
export const INTERESTS_MIGRATION_KEY = '_migrations.interests';

/** The driver key the folded-in interests live under (one consolidated `interest` driver). */
export const INTERESTS_DRIVER_KEY = 'interests';

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — cap on folded-in interest terms (scope:agent — a profile property; kind:internal
// — a signal-shaping bound, not a user-facing preference). `param()` returns 8 unchanged.
/** How many of the strongest learned terms to fold in — the signal, not the whole vocabulary. */
export const INTERESTS_MAX_TERMS = param({ key: 'interests.maxTerms', scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.INTERNAL, default: 8 });

const unwrap = (v) => (v && typeof v === 'object' && 'mode' in v ? v.value : v);

/** The strongest interest terms from a getInterestProfile snapshot, highest weight first. */
export function topInterestTerms(snapshot, max = INTERESTS_MAX_TERMS) {
  const terms = Array.isArray(snapshot?.topTerms) ? snapshot.topTerms : [];
  return terms
    .filter((t) => t && typeof t.term === 'string' && t.term.trim())
    .slice(0, max)
    .map((t) => t.term.trim());
}

/**
 * Seed the default profile's `interests` driver from the learned interest profile, once. Safe to
 * call on every Mij load — the marker makes repeats free.
 *
 * @param {object} args
 * @param {(origin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {string} [args.defaultId='default'] the root persona id
 * @returns {Promise<{ok: boolean, seeded?: string[], skipped?: boolean, already?: boolean, reason?: string}>}
 */
export async function migrateInterests({ callSkill, defaultId = 'default' } = {}) {
  if (typeof callSkill !== 'function') return { ok: false, reason: 'no-callskill' };

  // marker — already seeded?
  let props = null;
  try { props = await callSkill('agents', 'getProfileProperties', { id: defaultId }); } catch { /* */ }
  if (!props || props.ok === false) return { ok: false, reason: 'no-profile' };
  if (unwrap(props?.properties?.[INTERESTS_MIGRATION_KEY])) return { ok: true, already: true };

  // Source: the learned Layer-2 interest profile's strongest terms → tags on one interest driver.
  let tags = [];
  try {
    const snap = await callSkill('stoop', 'getInterestProfile', {});
    tags = topInterestTerms(snap);
  } catch { /* */ }

  if (tags.length) {
    try {
      const res = await callSkill('agents', 'setProfileDriver', {
        id: defaultId, key: INTERESTS_DRIVER_KEY, kind: 'interest', text: '', tags,
      });
      if (res?.ok === false) return { ok: false, reason: 'set-failed' };
    } catch { return { ok: false, reason: 'set-failed' }; }
  }

  // mark done (only after any seed persisted) so re-runs are free
  try {
    await callSkill('agents', 'setProfileProperty', { id: defaultId, key: INTERESTS_MIGRATION_KEY, value: 'done' });
  } catch { /* */ }

  return tags.length ? { ok: true, seeded: tags } : { ok: true, skipped: true };
}
