/**
 * basis v2 — multi-kring screen materializer (Plan α.2.b).
 *
 * Takes a user-defined Screen + the user's full kring list, and
 * materializes each block by gathering data from the screen's
 * kringFilter (or all kringen when filter is null).  Result shape
 * matches what `circleScreen` / `CircleScreenView` already render —
 * per-block `{blockId, type, status, content}` — so the existing
 * renderers consume screen output unchanged.
 *
 * (muted): drop blocks from circles in the `mutedCircleIds` set.
 * "Hide entirely" applies BEFORE the per-block merge — a muted kring
 * contributes nothing.
 *
 * Per-block kring-aware sources:
 *   announcement / text / photo  → kring-agnostic; render once
 *   noticeboard                  → merge stream rows across kringen,
 *                                  sort newest-first, cap to limit
 *   agenda                       → merge calendar events across the
 *                                  user's kringen (calendar IS user-
 *                                  scoped today; multi-kring is a
 *                                  follow-up once events carry
 *                                  circleId), cap to limit
 *   rules                        → multi-kring is ambiguous; degrade
 *                                  to "first kring only" with a
 *                                  diagnostic in the content
 */

import { effectiveKringIds, isAllKringen } from './userScreens.js';
import { circleRows } from './circleStream.js';
import { normalizeRulesDoc, isRulesEmpty } from './circleRules.js';
import { materializeBlock as _materializeKringBlock } from './kringRecipeBlocks.js';

/**
 * Materialize a Screen.  Returns Promise<Array<MaterializedBlock>>
 * matching `materializeRecipe`'s output shape.
 *
 * @param {object} args
 * @param {object} args.screen
 * @param {object} args.hostOps              { callSkill, eventLog, circles }
 * @param {Set<string>|Array<string>} [args.mutedCircleIds]
 *        circles the local user has muted; their data is suppressed
 *        per ("hide entirely").
 * @returns {Promise<Array<object>>}
 */
export async function materializeScreen({ screen, hostOps = {}, mutedCircleIds = null } = {}) {
  if (!screen || !Array.isArray(screen?.blocks) || screen.blocks.length === 0) return [];
  const muted = mutedCircleIds instanceof Set
    ? mutedCircleIds
    : new Set(Array.isArray(mutedCircleIds) ? mutedCircleIds : []);

  const allCircleIds = (hostOps.circles ?? []).map((c) => c?.id).filter(Boolean);
  const filterIds = effectiveKringIds(screen, allCircleIds);
  const activeCircleIds = filterIds.filter((id) => !muted.has(id));
  // When the user has muted EVERY kring in the filter, an empty active
  // list means kring-aware blocks render empty ("hide entirely").

  return Promise.all(screen.blocks.map((block) => materializeOneBlock({
    block, activeCircleIds, allCircleIds, hostOps,
    screenIsAll: isAllKringen(screen),
  })));
}

/* ─────────────────────────────────────────────────────────────────────── */

async function materializeOneBlock({ block, activeCircleIds, hostOps, screenIsAll }) {
  try {
    switch (block?.type) {
      // Kring-agnostic: identical to per-kring materializer's behaviour.
      case 'announcement':
      case 'text':
      case 'photo':
        return await _materializeKringBlock({ block, hostOps });

      case 'noticeboard':
        return materializeNoticeboard(block, activeCircleIds, hostOps);

      case 'agenda':
        return await materializeAgenda(block, activeCircleIds, hostOps);

      case 'tasks':
        return await materializeTasks(block, activeCircleIds, hostOps);

      case 'rules':
        return await materializeRules(block, activeCircleIds, hostOps, screenIsAll);

      default:
        return { blockId: block?.id, type: block?.type, status: 'error',
                 content: {}, error: 'unknown type' };
    }
  } catch (err) {
    return { blockId: block?.id, type: block?.type, status: 'error',
             content: {}, error: String(err?.message ?? err) };
  }
}

function materializeNoticeboard(block, activeCircleIds, { eventLog, circles } = {}) {
  const limit = clampInt(block.config?.limit, 1, 100, 5);
  if (!eventLog?.query || activeCircleIds.length === 0) {
    return { blockId: block.id, type: 'noticeboard', status: 'empty', content: { items: [] } };
  }
  const events = eventLog.query({ excludeMuted: true });
  // The projector takes a circle LIST, so a multi-circle Screen is one call. This used to loop per circle
  // and merge by hand — hand-rolling the very thing a Screen expresses (`kringFilter` IS a scope), which is
  // what made the missing list-scope obvious. Rows stay newest-first and each keeps its `circleId` for the
  // tag, exactly as before.
  const items = circleRows({ events, circles: circles ?? [], circleId: activeCircleIds })
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .slice(0, limit);
  return {
    blockId: block.id, type: 'noticeboard',
    status: items.length > 0 ? 'ok' : 'empty',
    content: { items },
  };
}

async function materializeAgenda(block, activeCircleIds, { callSkill } = {}) {
  const limit       = clampInt(block.config?.limit,       1, 100, 5);
  const horizonDays = clampInt(block.config?.horizonDays, 1, 365, 14);
  if (typeof callSkill !== 'function') {
    return { blockId: block.id, type: 'agenda', status: 'empty', content: { items: [] } };
  }
  // Calendar's listEvents is user-scoped today (no circleId arg).
  // When the screen narrows to a kring subset, we'd ideally filter
  // events that carry a circleId in source.  The current calendar
  // store doesn't expose that, so for V0 we return all upcoming events
  // when ANY kring is active (covers the common "Stream"/"all" case)
  // and empty when EVERY kring in the filter is muted.
  if (activeCircleIds.length === 0) {
    return { blockId: block.id, type: 'agenda', status: 'empty', content: { items: [] } };
  }
  const res = await callSkill('calendar', 'listEvents', { days: horizonDays });
  const items = Array.isArray(res?.items) ? res.items.slice(0, limit) : [];
  return {
    blockId: block.id, type: 'agenda',
    status: items.length > 0 ? 'ok' : 'empty',
    content: { items },
  };
}

/**
 * α.4 — tasks block across multiple kringen.  Query each active kring's
 * tasks circle, filter by scope, merge + cap.  The "Mijn dingen" screen
 * uses scope:'assigned-to-me' across kringFilter=ALL to aggregate every
 * task assigned to the user across the kringen they're in.
 */
async function materializeTasks(block, activeCircleIds, { callSkill, myWebid, circles } = {}) {
  const limit = clampInt(block.config?.limit, 1, 200, 10);
  const scope = block.config?.scope === 'all' ? 'all' : 'assigned-to-me';
  if (typeof callSkill !== 'function' || activeCircleIds.length === 0) {
    return { blockId: block.id, type: 'tasks', status: 'empty', content: { items: [], scope } };
  }
  const circleNameMap = new Map((circles ?? []).map((c) => [c?.id, c?.name ?? '']));
  const buckets = await Promise.all(activeCircleIds.map(async (cid) => {
    try {
      const res = await callSkill('tasks', 'listOpen', { circleId: cid });
      const raw = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      return raw.map((t) => ({
        id:         t.id,
        text:       t.text ?? t.title ?? t.label ?? '',
        state:      t.state ?? t.status ?? 'open',
        assignee:   t.assignee ?? null,
        circleId:   cid,
        circleName: circleNameMap.get(cid) ?? '',
        _ts:        t.addedAt ?? t.ts ?? 0,
      }));
    } catch { return []; }
  }));
  const merged = buckets.flat();
  const filtered = scope === 'all'
    ? merged
    : merged.filter((t) => {
        if (!t.assignee) return false;
        if (myWebid == null) return true;
        return t.assignee === myWebid;
      });
  filtered.sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0));
  const items = filtered.slice(0, limit);
  return {
    blockId: block.id, type: 'tasks',
    status: items.length > 0 ? 'ok' : 'empty',
    content: { items, scope },
  };
}

async function materializeRules(block, activeCircleIds, { callSkill } = {}, screenIsAll = false) {
  if (typeof callSkill !== 'function' || activeCircleIds.length === 0) {
    return { blockId: block.id, type: 'rules', status: 'empty',
             content: { rules: null, doc: normalizeRulesDoc(null) } };
  }
  // Rules are per-kring.  For a multi-kring screen we degrade to the
  // first kring's rules with a `multiKring` flag the renderer can
  // surface as a hint ("Showing rules of <name> only — pick a single
  // kring to focus.").  Single-kring (or screenIsAll with 1 kring)
  // renders cleanly.
  const cid = activeCircleIds[0];
  const res = await callSkill('stoop', 'getGroupRules', { groupId: cid });
  const rules = res?.rules ?? null;
  const docRaw = rules?.source?.doc ?? rules?.doc ?? null;
  const doc = normalizeRulesDoc(docRaw);
  const multiKring = activeCircleIds.length > 1 || (screenIsAll && activeCircleIds.length > 1);
  return {
    blockId: block.id, type: 'rules',
    status: isRulesEmpty(doc) ? 'empty' : 'ok',
    content: { rules, doc, multiKring, shownCircleId: cid },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */

function clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'number' && Number.isFinite(v) ? (v | 0) : fallback;
  return Math.max(lo, Math.min(hi, n));
}
