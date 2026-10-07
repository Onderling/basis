/**
 * basis v2 — multi-circle screen materializer (Plan α.2.b).
 *
 * Takes a user-defined Screen + the user's full circle list, and
 * materializes each block by gathering data from the screen's
 * circleFilter (or all circles when filter is null).  Result shape
 * matches what `circleScreen` / `CircleScreenView` already render —
 * per-block `{blockId, type, status, content}` — so the existing
 * renderers consume screen output unchanged.
 *
 * (muted): drop blocks from circles in the `mutedCircleIds` set.
 * "Hide entirely" applies BEFORE the per-block merge — a muted circle
 * contributes nothing.
 *
 * Per-block circle-aware sources:
 *   announcement / text / photo  → circle-agnostic; render once
 *   noticeboard                  → merge stream rows across circles,
 *                                  sort newest-first, cap to limit
 *   agenda                       → merge calendar events across the
 *                                  user's circles (calendar IS user-
 *                                  scoped today; multi-circle is a
 *                                  follow-up once events carry
 *                                  circleId), cap to limit
 *   rules                        → multi-circle is ambiguous; degrade
 *                                  to "first circle only" with a
 *                                  diagnostic in the content
 */

import { acrossCircles } from './acrossCircles.js';
import { ITEM_PRESENTERS } from './itemPresenters.js';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { calendarManifest } from '../../../calendar/manifest.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';
import { householdManifest } from '../../../household/manifest.js';
import { effectiveCircleIds, isAllCircles } from './userScreens.js';
import { circleRows } from './circleStream.js';
import { normalizeRulesDoc, isRulesEmpty } from './circleRules.js';
import { materializeBlock as _materializeCircleBlock } from './circleRecipeBlocks.js';

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
  const filterIds = effectiveCircleIds(screen, allCircleIds);
  const activeCircleIds = filterIds.filter((id) => !muted.has(id));
  // When the user has muted EVERY circle in the filter, an empty active
  // list means circle-aware blocks render empty ("hide entirely").

  return Promise.all(screen.blocks.map((block) => materializeOneBlock({
    block, activeCircleIds, allCircleIds, hostOps,
    screenIsAll: isAllCircles(screen),
  })));
}

/* ─────────────────────────────────────────────────────────────────────── */

async function materializeOneBlock({ block, activeCircleIds, hostOps, screenIsAll }) {
  try {
    switch (block?.type) {
      // Circle-agnostic: identical to per-circle materializer's behaviour.
      case 'announcement':
      case 'text':
      case 'photo':
        return await _materializeCircleBlock({ block, hostOps });

      case 'noticeboard':
        return materializeNoticeboard(block, activeCircleIds, hostOps);

      // ONE block for any item type over the one cross-circle projection; a screen that still holds the older
      // `tasks` / `calendar` block is read as the items block it is (no second path to keep in step)
      case 'items':
        return await materializeItems(block, activeCircleIds, hostOps);
      case 'calendar':
        return await materializeItems({ ...block, config: { noun: 'calendar-event', scope: 'all', ...(block.config ?? {}) } }, activeCircleIds, hostOps);
      case 'tasks':
        return await materializeItems({ ...block, config: { noun: 'task', scope: block.config?.scope === 'all' ? 'all' : 'mine', limit: block.config?.limit } }, activeCircleIds, hostOps);

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
  // and merge by hand — hand-rolling the very thing a Screen expresses (`circleFilter` IS a scope), which is
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

/** The apps whose `list` a cross-circle items block may resolve (first that answers the noun). */
export const ITEM_MANIFESTS = Object.freeze([
  { appOrigin: 'calendar', manifest: calendarManifest },
  { appOrigin: 'tasks', manifest: tasksManifest },
  { appOrigin: 'household', manifest: householdManifest },
]);

/**
 * An `items` block: `{noun, scope: 'mine'|'all', limit, horizonDays}` across the screen's active circles, through
 * `acrossCircles` (the type's own list per circle, its presenter for mine / order). Appointments also take the person's
 * own calendar (no circle) — the fold keeps those on the person's store.
 */
async function materializeItems(block, activeCircleIds, { callSkill, myWebid, circles } = {}) {
  const noun = String(block.config?.noun ?? '');
  const scope = block.config?.scope === 'mine' ? 'mine' : 'all';
  const limit = clampInt(block.config?.limit, 1, 200, 10);
  const horizonDays = clampInt(block.config?.horizonDays, 1, 365, 14);
  const empty = { blockId: block.id, type: 'items', status: 'empty', content: { noun, scope, items: [] } };
  if (typeof callSkill !== 'function' || activeCircleIds.length === 0) return empty;
  const presenter = ITEM_PRESENTERS[noun];
  if (!presenter) return { blockId: block.id, type: 'items', status: 'error', content: { noun }, error: 'no presenter' };
  const names = new Map((circles ?? []).map((c) => [c?.id, c?.name ?? '']));
  const isAgenda = noun === 'calendar-event';
  const until = Date.now() + horizonDays * 86_400_000;
  const r = await acrossCircles({
    circles: activeCircleIds.map((id) => ({ id, name: names.get(id) ?? '' })), noun, scope, me: myWebid ?? null, limit: 500,
    manifests: ITEM_MANIFESTS,
    callSkill: (app, op, args) => callSkill(app, op, isAgenda ? { ...args, days: horizonDays } : args),
    genericFor: (circleId) => ({ list: async (n) => (await callSkill('household', encodeGenericOpId('household', 'list', n), { circleId }))?.result ?? [] }),
  });
  let rows = r.ok ? r.items : [];
  let ownError = null;
  if (isAgenda) {
    // my own appointments (no circle), beside the circles'
    const own = await callSkill('calendar', 'listEvents', { days: horizonDays }).catch((err) => { ownError = String(err?.message ?? err); return null; });
    const mine = (Array.isArray(own?.items) ? own.items : []).map((e) => ({ ...e, circleId: null, circleName: '' }));
    rows = [...rows, ...mine].filter((e) => !presenter.when(e) || presenter.when(e) <= until)
      .sort((a, b) => presenter.when(a) - presenter.when(b));
  }
  // nothing answered (every circle, and my own calendar when it is asked): a failure, said as one
  if (!r.ok && r.reason === 'unreachable' && (!isAgenda || ownError)) return { blockId: block.id, type: 'items', status: 'error', content: { noun }, error: r.error };
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id, label: row.label ?? presenter.label(row), when: presenter.when(row) || null,
    circleId: row.circleId ?? null, circleName: row.circleName ?? '', mine: presenter.isMine(row, myWebid ?? null),
    // what a chore row also shows: its words, its state, its "see also" links
    text: row.text ?? row.label ?? presenter.label(row), ...(row.state ? { state: row.state } : {}), ...(Array.isArray(row.embeds) ? { embeds: row.embeds } : {}),
  }));
  return { blockId: block.id, type: 'items', status: items.length ? 'ok' : 'empty', content: { noun, scope, items } };
}

async function materializeRules(block, activeCircleIds, { callSkill } = {}, screenIsAll = false) {
  if (typeof callSkill !== 'function' || activeCircleIds.length === 0) {
    return { blockId: block.id, type: 'rules', status: 'empty',
             content: { rules: null, doc: normalizeRulesDoc(null) } };
  }
  // Rules are per-circle.  For a multi-circle screen we degrade to the
  // first circle's rules with a `multiCircle` flag the renderer can
  // surface as a hint ("Showing rules of <name> only — pick a single
  // circle to focus.").  Single-circle (or screenIsAll with 1 circle)
  // renders cleanly.
  const cid = activeCircleIds[0];
  const res = await callSkill('stoop', 'getGroupRules', { groupId: cid });
  const rules = res?.rules ?? null;
  const docRaw = rules?.source?.doc ?? rules?.doc ?? null;
  const doc = normalizeRulesDoc(docRaw);
  const multiCircle = activeCircleIds.length > 1 || (screenIsAll && activeCircleIds.length > 1);
  return {
    blockId: block.id, type: 'rules',
    status: isRulesEmpty(doc) ? 'empty' : 'ok',
    content: { rules, doc, multiCircle, shownCircleId: cid },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */

function clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'number' && Number.isFinite(v) ? (v | 0) : fallback;
  return Math.max(lo, Math.min(hi, n));
}
