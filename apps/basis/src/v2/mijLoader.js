/**
 * mijLoader — the ONE shared load sequence behind the "Mij → persona's"
 * surface, used verbatim by BOTH hosts (web `circleApp.js` openAboutMePanel;
 * mobile `basis-mobile/src/core/mijHost.js`) so the sequence cannot drift
 * (invariant #3 — this replaces the inline web copy + the mobile twin):
 *
 *   [migrate active circle's roster skills — phase D, marker-guarded]
 *   listAgents (role 'profile') → getProfileProperties / getProfileDisclosure
 *   per persona → getPersonaRelease per enabled context → buildMijViewModel.
 *
 * All ops ride the injected `callSkill(origin, opId, args)`; hosts re-run the
 * loader after each edit so the surface reflects the PERSISTED state.
 */

import { buildMijViewModel } from './personaView.js';
import { migrateRosterOfferings } from '../core/offeringsMigration.js';
import { migrateAvailability } from '../core/availabilityMigration.js';
import { migrateLocation } from '../core/locationMigration.js';
import { migrateInterests } from '../core/interestsMigration.js';

export { offeringKeyFor } from '../core/offeringsMigration.js';

/**
 * @param {object} args
 * @param {(origin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {string} [args.personaId]      the opened profile row (kept even when listAgents degrades)
 * @param {Array<{id: string, name?: string, charter?: object}>} [args.circles]
 * @param {string} [args.activeCircleId] when given, phase-D roster-skills migration
 *                                       runs first (free after the first time — marker)
 * @returns {Promise<object>} the buildMijViewModel result
 */
export async function loadMijModel({ callSkill, personaId, circles = [], activeCircleId } = {}) {
  if (activeCircleId) {
    try { await migrateRosterOfferings({ callSkill, circleId: activeCircleId }); } catch { /* non-fatal */ }
    // availability unification — one-time, marker-guarded seed of the unified
    // `availability` property from the most-restrictive legacy signal (holidayMode /
    // per-skill availability). Reads the active circle's stoop context; global once seeded.
    try { await migrateAvailability({ callSkill }); } catch { /* non-fatal */ }
    // location fold-in (audit §4) — one-time, marker-guarded seed of the person-level
    // `location` property from the bespoke stoop `profile.location` coarse geo field.
    try { await migrateLocation({ callSkill }); } catch { /* non-fatal */ }
    // interests fold-in (audit 4) — one-time, marker-guarded seed of an `interest`-kind
    // driver from the bespoke learned Layer-2 interest signal (stoop getInterestProfile terms).
    try { await migrateInterests({ callSkill }); } catch { /* non-fatal */ }
  }

  // Every profile-role registry entry is a persona; the opened row + the
  // default profile are included even when the list op degrades.
  let rows = [];
  try {
    const listed = await callSkill('agents', 'listAgents', {});
    // Both shapes — see `loadPersonas`. This reader was broken the same way and it did not SHOW, because the
    // fallback below synthesises a `default` row when the list comes back empty: Mij looked right while the
    // join step silently offered nothing. A fallback that hides a broken read is worse than no fallback.
    rows = (listed?.agents ?? listed?.items ?? []).filter((a) => a?.role === 'profile');
  } catch { rows = []; }
  if (!rows.some((r) => r.agentId === 'default')) rows.unshift({ agentId: 'default', name: 'default' });
  if (personaId && !rows.some((r) => r.agentId === personaId)) rows.push({ agentId: personaId, name: personaId });

  const personas = await Promise.all(rows.map(async (r) => {
    let props = null; let disc = null;
    try { props = await callSkill('agents', 'getProfileProperties', { id: r.agentId }); } catch { /* */ }
    try { disc = await callSkill('agents', 'getProfileDisclosure', { id: r.agentId }); } catch { /* */ }
    return {
      id:         r.agentId,
      name:       r.name ?? r.agentId,
      properties: props?.properties ?? {},
      disclosure: disc?.disclosure ?? { perContext: {} },
    };
  }));

  // The released values per persona × circle (only where something is enabled).
  const releases = {};
  await Promise.all(personas.map(async (p) => {
    for (const [ctxId, policy] of Object.entries(p.disclosure?.perContext ?? {})) {
      const keys = Object.entries(policy ?? {}).filter(([, e]) => e?.enabled === true).map(([k]) => k);
      if (!keys.length) continue;
      try {
        const rel = await callSkill('agents', 'getPersonaRelease', { id: p.id, contextId: ctxId, keys: keys.join(',') });
        if (rel?.ok) (releases[p.id] ??= {})[ctxId] = rel.released ?? {};
      } catch { /* */ }
    }
  }));

  // WHAT THE LANE HOLDS FOR ME in each circle — my own roster row's `said.personaProperties` (`member-props`).
  // The model needs it to offer "stop sharing" for a circle where nothing is disclosed any more but the
  // co-members still hold something. Read per circle, best-effort: a circle that cannot be read simply
  // offers nothing, which is the safe direction.
  const withLane = await Promise.all((Array.isArray(circles) ? circles : []).map(async (c) => {
    const id = typeof c === 'string' ? c : (c?.id ?? c?.groupId);
    if (!id) return c;
    try {
      const me = (await callSkill('stoop', 'whoAmI', {}))?.webid ?? null;
      const rows = (await callSkill('stoop', 'listGroupMembers', { groupId: id }))?.members ?? [];
      const mine = me ? rows.find((m) => (m.webid ?? m.addr ?? m.ref) === me) : null;
      const said = mine?.said?.personaProperties;
      return { ...c, ...(said && typeof said === 'object' ? { sharedOnLane: said } : {}) };
    } catch { return c; }
  }));
  return buildMijViewModel({ personas, circles: withLane, releases });
}
