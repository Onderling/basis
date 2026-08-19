/**
 * offeringsMigration — one-time, per-circle lift of ROSTER offerings into the
 * root persona (the truth layer). Phase D of the skills→property fold-in
 * (plans/NOTE-skills-properties-audit.md §3c).
 *
 * The roster (stoop `MemberMap.skills`) is per-circle and only reachable in
 * that circle's service-context, so migration is INCREMENTAL: each circle's
 * skills fold in the first time the Mij surface loads with that circle
 * active. A marker property on the default profile records which circles are
 * done, so re-runs are no-ops. The roster projection itself stays untouched
 * (matching keeps working; the stoop ops remain the projection writer).
 *
 * NO-SILENT-RETRACTION (decision corollary): members of a circle already
 * SAW `categoryId` + `freeTags` on the roster — so migrated keys get
 * disclosure enabled at rung 'full' for that circle, preserving exactly what
 * was visible. Everywhere else stays withheld (the charter-driven default
 * applies only at new joins).
 */

import { OFFERINGS_TAXONOMY } from '@onderling/agent-registry';

/** Marker property on the default profile: comma-joined migrated circle ids.
 *  Not a charter key and not a driver value, so no surface renders it. */
export const OFFERINGS_MIGRATION_KEY = '_migrations.offeringsRoster';
/** Legacy marker (pre-offering rename). Still honoured on read so an already-
 *  migrated circle never re-runs — no destructive migration. */
export const LEGACY_SKILLS_MIGRATION_KEY = '_migrations.skillsRoster';

/** The web/mobile UI's offering key derivation — keyed by the phrase; re-use edits. */
export function offeringKeyFor({ text, tags }) {
  return (text || tags).trim().toLowerCase().slice(0, 40);
}

const unwrap = (v) => (v && typeof v === 'object' && 'mode' in v ? v.value : v);

function categoryLabelNl(categoryId) {
  const cat = OFFERINGS_TAXONOMY.categories.find((c) => c.id === categoryId);
  return cat?.label?.nl ?? null;
}

/**
 * Migrate the ACTIVE circle's roster skills into the default profile.
 * Safe to call on every Mij load — the marker makes repeats free.
 *
 * @param {object} args
 * @param {(origin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {string} args.circleId    the active circle (its roster is what's reachable)
 * @param {string} [args.defaultId] the root persona id
 * @returns {Promise<{ok: boolean, migrated?: number, already?: boolean, reason?: string}>}
 */
export async function migrateRosterOfferings({ callSkill, circleId, defaultId = 'default' } = {}) {
  if (typeof callSkill !== 'function' || !circleId) return { ok: false, reason: 'no-circle' };

  // marker — which circles are already folded in. Read-accept the legacy
  // marker key too so a circle migrated before the rename never re-runs.
  let props = null;
  try { props = await callSkill('agents', 'getProfileProperties', { id: defaultId }); } catch { /* */ }
  if (!props || props.ok === false) return { ok: false, reason: 'no-profile' };
  const markerValue = String(unwrap(props?.properties?.[OFFERINGS_MIGRATION_KEY]) ?? '')
    + ',' + String(unwrap(props?.properties?.[LEGACY_SKILLS_MIGRATION_KEY]) ?? '');
  const done = new Set(markerValue.split(',').filter(Boolean));
  if (done.has(circleId)) return { ok: true, migrated: 0, already: true };

  // this circle's roster: my own skills as every member of it already sees them
  let skills = [];
  try {
    const r = await callSkill('stoop', 'listMyOfferings', {});
    skills = Array.isArray(r?.skills) ? r.skills : [];
  } catch { skills = []; }

  let migrated = 0;
  const keys = [];
  for (const s of skills) {
    const freeTags = Array.isArray(s?.freeTags) ? s.freeTags.filter(Boolean) : [];
    if (!s?.categoryId && freeTags.length === 0) continue;
    const text = freeTags.length ? freeTags.join(' ') : (categoryLabelNl(s.categoryId) ?? s.categoryId);
    const key = offeringKeyFor({ text, tags: freeTags.join(' ') });
    if (keys.includes(key)) continue; // same phrase twice on one roster — one item
    try {
      const res = await callSkill('agents', 'setProfileDriver', {
        id: defaultId, key, kind: 'offering', text, tags: freeTags,
        categoryId: typeof s.categoryId === 'string' ? s.categoryId : undefined,
      });
      if (res?.ok === false) continue;
      migrated += 1;
      keys.push(key);
    } catch { /* keep going — partial migration retries next load (marker set below only on success path) */ }
  }

  // no-silent-retraction: this circle keeps seeing what it already saw — full rung
  for (const key of keys) {
    try {
      await callSkill('agents', 'setProfileDisclosure', {
        id: defaultId, contextId: circleId, key, enabled: true, rung: 'full',
      });
    } catch { /* */ }
  }

  // mark the circle done (also when it had zero skills — no rescan every load)
  try {
    await callSkill('agents', 'setProfileProperty', {
      id: defaultId, key: OFFERINGS_MIGRATION_KEY, value: [...done, circleId].join(','),
    });
  } catch { /* */ }

  return { ok: true, migrated };
}
