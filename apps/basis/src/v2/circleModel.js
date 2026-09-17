/**
 * basis v2 — circle model (shared web + mobile).
 *
 * A "circle" is the EXISTING circle/group/circle label, not a new entity
 * (see `@onderling/circles` + `CIRCLE_ID_IS_CREW_ID_ALIAS`: circle.id ≡
 * task.circleId). This module normalises the circle-like sources the host
 * already exposes — tasks circles (`getMyCircles`), stoop groups, and
 * `@onderling/circles` items — into one launcher list. Pure and
 * host-injected so the same logic feeds the web launcher (`web/v2/`) and
 * the mobile screen (`screens/v2/`).
 */

/** Normalise one circle-like raw item to a launcher tile, or null if it has no id. */
import { isPairCircleId } from './pairCircleId.js';

export function normalizeCircle(raw = {}) {
  const id = raw.id ?? raw.circleId ?? raw.circleId ?? raw.groupId ?? null;
  if (!id) return null;
  const fromArray = Array.isArray(raw.members) ? raw.members.length : null;
  const memberCount = raw.memberCount ?? fromArray ?? raw.counts?.members ?? null;
  return {
    id,
    name: raw.name ?? raw.title ?? id,
    kind: raw.kind ?? raw.tone ?? null,
    memberCount,
    lastActivity: raw.lastActivity ?? raw.lastMessageAt ?? raw.updatedAt ?? null,
    features: Array.isArray(raw.features) ? raw.features : null,
  };
}

/**
 * Merge circle-like items from several host sources, de-duping by id.
 * Because circleId ≡ circleId, the same group seen via two sources collapses
 * into one tile, with later sources filling gaps left by earlier ones.
 */
export function mergeCircles(...sources) {
  const byId = new Map();
  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const c = normalizeCircle(raw);
      if (!c) continue;
      const prev = byId.get(c.id);
      byId.set(c.id, prev ? mergeOne(prev, c) : c);
    }
  }
  return [...byId.values()];
}

function mergeOne(a, b) {
  return {
    id: a.id,
    name: a.name ?? b.name,
    kind: a.kind ?? b.kind,
    memberCount: a.memberCount ?? b.memberCount,
    lastActivity: pickLatest(a.lastActivity, b.lastActivity),
    features: a.features ?? b.features,
  };
}

function pickLatest(x, y) {
  if (!x) return y;
  if (!y) return x;
  return Date.parse(x) >= Date.parse(y) ? x : y;
}

/**
 * Build the launcher list from host-provided async fetchers. Each fetcher
 * returns an array of raw circle-like items (or is omitted). A failing
 * source is tolerated — it contributes nothing rather than breaking the
 * launcher. Result is sorted most-recent-activity first, then by name.
 */
export async function loadCircles({ fetchTasksCircles, fetchGroups, fetchCircles } = {}) {
  const [tasksCircles, groups, circles] = await Promise.all([
    safe(fetchTasksCircles),
    safe(fetchGroups),
    safe(fetchCircles),
  ]);
  // A pair roster (a contact's, made automatically — `pairRoster.js`) is never a tile.
  return mergeCircles(tasksCircles, groups, circles).filter((c) => !isPairCircleId(c?.id)).sort(byActivityThenName);
}

async function safe(fn) {
  try {
    return fn ? await fn() : [];
  } catch {
    return [];
  }
}

function byActivityThenName(a, b) {
  const ax = a.lastActivity ? Date.parse(a.lastActivity) : 0;
  const bx = b.lastActivity ? Date.parse(b.lastActivity) : 0;
  if (ax !== bx) return bx - ax;
  return String(a.name).localeCompare(String(b.name));
}
