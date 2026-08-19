/**
 * basis v2 — block registry + content materializer (Plan α.1b).
 *
 * The recipe model (α.1a) stores block descriptors `{id, type, config}`.
 * This module turns each descriptor into a normalized content payload
 * the platform renderers (web DOM, RN) consume.  Data fetching uses
 * the existing host seams (`callSkill`, `eventLog`, `circles`) so we
 * don't duplicate plumbing per platform.
 *
 * Normalized output shape per block (`materializeBlock` resolves to):
 *
 *   {
 *     blockId:   <string>,        // copied from the recipe entry
 *     type:      <BLOCK_TYPE>,
 *     status:    'ok' | 'empty' | 'error',
 *     title?:    <string>,        // optional, set by some types
 *     content:   <type-specific>, // see per-type sections below
 *     error?:    <string>,        // only when status === 'error'
 *   }
 *
 *   announcement  content: { text }
 *   text          content: { text }
 *   photo         content: { src, caption }
 *   noticeboard   content: { items: Array<StreamRow> }
 *   agenda        content: { items: Array<{id, label, type, state}> }
 *   rules         content: { rules: <itemOrNull>, doc: <normalizedRulesDoc> }
 *
 * Pure / portable: zero DOM, zero RN.  All async work goes through the
 * injected `hostOps` so tests can mock with a Promise.resolve stub.
 */

import { BLOCK_TYPES } from './circleRecipe.js';
import { circleRows, stampSenderLabels } from './circleStream.js';
import { normalizeRulesDoc, isRulesEmpty } from './circleRules.js';
import { enabledFeatures } from './circlePolicy.js';
import { enrichEmbedsWithTitles } from './embedResolve.js';
import { isNoticeboardPost } from './circleStoopScope.js';

/**
 * Editor-side metadata per block type.  Drives the palette + the
 * default ordering shown in α.1d's editor.  `labelKey` resolves via
 * the standard `t()` localizer (locale keys land with α.1d).
 */
export const BLOCK_REGISTRY = Object.freeze({
  quickActions: { order: 0, labelKey: 'circle.recipe.block.quickActions', emoji: '⭐' },
  announcement: { order: 1, labelKey: 'circle.recipe.block.announcement', emoji: '📣' },
  noticeboard:  { order: 2, labelKey: 'circle.recipe.block.noticeboard',  emoji: '📌' },
  agenda:       { order: 3, labelKey: 'circle.recipe.block.agenda',       emoji: '📅' },
  tasks:        { order: 4, labelKey: 'circle.recipe.block.tasks',        emoji: '✅' },
  rules:        { order: 5, labelKey: 'circle.recipe.block.rules',        emoji: '📜' },
  photo:        { order: 6, labelKey: 'circle.recipe.block.photo',        emoji: '🖼️' },
  text:         { order: 7, labelKey: 'circle.recipe.block.text',         emoji: '✏️' },
});

/**
 * Materialize a single block.  Returns a Promise resolving to the
 * normalized shape above.  Never throws — type-level errors land in
 * `{status:'error', error}` so the renderer can show a per-block
 * fallback instead of breaking the whole page.
 *
 * @param {object} args
 * @param {{id: string, type: string, config: object}} args.block
 * @param {string} args.circleId          which circle the recipe belongs to
 * @param {object} args.hostOps           { callSkill, eventLog, circles, members?, viewerId?, revealPolicy? }
 *   — the optional roster trio lets sender-bearing blocks (noticeboard) stamp `senderLabel`
 *   through the reveal ladder (`revealPolicy`, NOT `policy` — that name already carries the full
 *   policy object for quickActions); absent → rows pass through unstamped (conservation).
 * @returns {Promise<object>}
 */
export async function materializeBlock({ block, circleId, hostOps = {} } = {}) {
  if (!block || typeof block !== 'object') return errorOut('?', '?', 'block missing');
  if (!BLOCK_TYPES.includes(block.type)) return errorOut(block.id, block.type, 'unknown type');
  try {
    switch (block.type) {
      case 'quickActions': return materializeQuickActions(block, circleId, hostOps);
      case 'announcement': return materializeAnnouncement(block);
      case 'text':         return materializeText(block);
      case 'photo':        return materializePhoto(block);
      case 'noticeboard':  return await materializeNoticeboard(block, circleId, hostOps);
      case 'agenda':       return await materializeAgenda(block, hostOps);
      case 'tasks':        return await materializeTasks(block, circleId, hostOps);
      case 'rules':        return await materializeRules(block, circleId, hostOps);
      default:             return errorOut(block.id, block.type, 'unhandled type');
    }
  } catch (err) {
    return errorOut(block.id, block.type, String(err?.message ?? err));
  }
}

/**
 * Materialize a whole recipe — convenience wrapper that runs blocks in
 * parallel and preserves order.  Renderers can call this once and
 * iterate the result.
 *
 * @returns {Promise<Array<object>>}  one normalized entry per block (in order)
 */
export async function materializeRecipe({ recipe, circleId, hostOps } = {}) {
  const blocks = Array.isArray(recipe?.blocks) ? recipe.blocks : [];
  if (blocks.length === 0) return [];
  return Promise.all(blocks.map((block) => materializeBlock({ block, circleId, hostOps })));
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Per-type materializers                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * D1 (§5A) — "Veel-gebruikt" quick-actions row.  Materializes the top-N
 * actions for this circle, frequency-weighted per the injected
 * `actionFrequency` store, falling back to the circle's enabled features
 * (`enabledFeatures(policy)`) when the user has no usage history yet.
 *
 * The candidate set is ALWAYS the enabled features — a frequency count
 * for a since-disabled feature is ignored, so the row never offers an
 * action the circle has turned off.  Frequency only reorders within that
 * set; ties + the cold-start case fall back to CIRCLE_FEATURES order.
 *
 * @param {{id:string, config?:{limit?:number}}} block
 * @param {string} circleId
 * @param {{ policy?: object, actionFrequency?: { top: Function } }} hostOps
 * @returns {{blockId, type, status, content:{actions:Array<{key:string}>, source:'frequency'|'default'}}}
 */
function materializeQuickActions(block, circleId, { policy, actionFrequency } = {}) {
  const limit = clampInt(block.config?.limit, 1, 8, 4);
  const candidates = enabledFeatures(policy);            // CIRCLE_FEATURES order
  const candidateSet = new Set(candidates);

  // Frequency ranking restricted to currently-enabled features.
  let ranked = [];
  if (actionFrequency && typeof actionFrequency.top === 'function' && circleId) {
    ranked = actionFrequency.top(circleId, candidates.length + candidateSet.size)
      .filter((k) => candidateSet.has(k));
  }
  const usedFrequency = ranked.length > 0;

  // Most-used first, then any remaining enabled features in default order.
  const seen = new Set(ranked);
  const ordered = [...ranked, ...candidates.filter((k) => !seen.has(k))];
  const actions = ordered.slice(0, limit).map((key) => ({ key }));

  return {
    blockId: block.id, type: 'quickActions',
    status: actions.length > 0 ? 'ok' : 'empty',
    content: { actions, source: usedFrequency ? 'frequency' : 'default' },
  };
}

function materializeAnnouncement(block) {
  const text = stringOr(block.config?.text, '').trim();
  return {
    blockId: block.id, type: 'announcement',
    status: text ? 'ok' : 'empty',
    content: { text },
    // α.5c — surface the compact flag so the renderer can tighten rows.
    config: { compact: block.config?.compact === true },
  };
}

function materializeText(block) {
  const text = stringOr(block.config?.text, '').trim();
  return {
    blockId: block.id, type: 'text',
    status: text ? 'ok' : 'empty',
    content: { text },
  };
}

function materializePhoto(block) {
  const src     = stringOr(block.config?.src,     '').trim();
  const caption = stringOr(block.config?.caption, '').trim();
  return {
    blockId: block.id, type: 'photo',
    status: src ? 'ok' : 'empty',
    content: { src, caption },
  };
}

async function materializeNoticeboard(block, circleId, { callSkill, eventLog, circles, members, viewerId, revealPolicy } = {}) {
  const limit = clampInt(block.config?.limit, 1, 50, 5);
  let rows = [];
  // #16 — prefer the REAL open posts (stoop `listOpen`) so the screen noticeboard
  // surfaces the noticeboard even when the chat tab (where the noticeboard lives) is
  // hidden. Map each post into the StreamRow shape the renderer's pickSender/
  // pickRowText read. Falls back to the eventLog stream when no callSkill.
  let listOpenSucceeded = false;
  if (typeof callSkill === 'function') {
    try {
      const res = await callSkill('stoop', 'listOpen', {});
      // Keep only real asks/offers — drop system items (rules / membership lifecycle)
      // that listOpen returns alongside posts.
      const items = (Array.isArray(res?.items) ? res.items : []).filter(isNoticeboardPost);
      rows = items.slice(0, limit).map((it) => ({
        id: it.id,
        // The FULL webid, not `shortWebid(...)` (batch 4): the shortening was display-only, display
        // now goes through `senderLabel`, and the full id is what lets the roster stamp match.
        actor: it.addedBy ?? null,
        event: { payload: { text: it.text ?? it.label ?? '' } },
      }));
      listOpenSucceeded = true;
    } catch { rows = []; }
  }
  // Fall back to the eventLog stream ONLY when listOpen wasn't available (no callSkill /
  // it threw). When listOpen succeeded, an empty result means "no posts" — do NOT fall
  // back, or the stream re-surfaces the very system/bookkeeping rows we just filtered out.
  if (!listOpenSucceeded && rows.length === 0 && eventLog?.query && circleId) {
    const events = eventLog.query({ excludeMuted: true });
    const stream = circleRows({ events, circles: circles ?? [], circleId });
    // circleRows returns newest-first; cap to `limit`.
    rows = stream.slice(0, limit);
  }
  // Sender labels through the reveal ladder (batch 4) — same stamp `chatRows` applies, so the
  // noticeboard renderers paint `senderLabel`/`senderLabelKey` and never a raw id or wire name.
  // Without a roster in hostOps the rows pass through unstamped (conservation).
  if (Array.isArray(members)) {
    rows = stampSenderLabels(rows, { members, viewerId: viewerId ?? null, policy: revealPolicy ?? 'pairwise' });
  }
  return {
    blockId: block.id, type: 'noticeboard',
    status: rows.length > 0 ? 'ok' : 'empty',
    content: { items: rows },
    // α.5c — surface the compact flag so the renderer can tighten rows.
    config: { compact: block.config?.compact === true },
  };
}

async function materializeAgenda(block, { callSkill } = {}) {
  const limit       = clampInt(block.config?.limit,       1, 50,  5);
  const horizonDays = clampInt(block.config?.horizonDays, 1, 365, 14);
  if (typeof callSkill !== 'function') {
    return { blockId: block.id, type: 'agenda', status: 'empty', content: { items: [] } };
  }
  const res = await callSkill('calendar', 'listEvents', { days: horizonDays });
  const items = Array.isArray(res?.items) ? res.items.slice(0, limit) : [];
  return {
    blockId: block.id, type: 'agenda',
    status: items.length > 0 ? 'ok' : 'empty',
    content: { items },
    // α.5c — surface the compact flag so the renderer can tighten rows.
    config: { compact: block.config?.compact === true },
  };
}

/**
 * α.4 — tasks block.  Calls the tasks circle's listOpen scoped to the
 * circleId (treated as the circle id by basis's resolver) +
 * filters by scope:
 *   'assigned-to-me' — task.assignee equals myWebid (or undefined when
 *                      myWebid isn't known — single-user dev)
 *   'all'            — every open task in the circle
 * Caps to limit, returns `{items: [{id, text, state, assignee, circleId}]}`.
 */
async function materializeTasks(block, circleId, { callSkill, myWebid, fetchImpl } = {}) {
  const limit = clampInt(block.config?.limit, 1, 100, 10);
  const scope = block.config?.scope === 'all' ? 'all' : 'assigned-to-me';
  if (typeof callSkill !== 'function' || !circleId) {
    return { blockId: block.id, type: 'tasks', status: 'empty', content: { items: [] } };
  }
  const res = await callSkill('tasks', 'listOpen', { circleId: circleId });
  const raw = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
  const filtered = scope === 'all'
    ? raw
    : raw.filter((t) => assigneeMatches(t, myWebid));
  let items = filtered.slice(0, limit).map((t) => ({
    id:       t.id,
    text:     t.text ?? t.title ?? t.label ?? '',
    state:    t.state ?? t.status ?? 'open',
    assignee: t.assignee ?? null,
    circleId,
    // embeds[] — cross-object references a task carries (→ another task / event /
    // post). Surfaced as "See also" chips on the task card (resolved below).
    embeds:   Array.isArray(t.embeds) ? t.embeds
              : (Array.isArray(t.source?.embeds) ? t.source.embeds : []),
  }));
  // Resolve embed refs to live titles (circleId = circle id; fetchImpl = the pod
  // session's authed fetch, for the user's own private cross-pod refs). Best-effort.
  items = await Promise.all(items.map(async (it) => (
    it.embeds.length
      ? { ...it, embeds: await enrichEmbedsWithTitles({ callSkill, embeds: it.embeds, circleId: circleId, fetchImpl }) }
      : it
  )));
  return {
    blockId: block.id, type: 'tasks',
    status: items.length > 0 ? 'ok' : 'empty',
    content: { items, scope },
    // α.5c — surface the compact flag so the renderer can tighten rows.
    config: { compact: block.config?.compact === true },
  };
}

function assigneeMatches(task, myWebid) {
  const a = task?.assignee;
  if (!a) return false;           // unassigned → never in "assigned-to-me"
  if (myWebid == null) return true;  // dev mode: any assigned task counts
  return a === myWebid;
}

async function materializeRules(block, circleId, { callSkill } = {}) {
  if (typeof callSkill !== 'function' || !circleId) {
    return { blockId: block.id, type: 'rules', status: 'empty', content: { rules: null, doc: normalizeRulesDoc(null) } };
  }
  const res = await callSkill('stoop', 'getGroupRules', { groupId: circleId });
  const rules = res?.rules ?? null;
  // Rules doc lives on the stoop item under source.doc (created by the
  // rules wizard); fall through to a top-level `doc` for any legacy
  // shape and let normalizeRulesDoc fill in the canonical fields.
  const docRaw = rules?.source?.doc ?? rules?.doc ?? null;
  const doc = normalizeRulesDoc(docRaw);
  return {
    blockId: block.id, type: 'rules',
    status: isRulesEmpty(doc) ? 'empty' : 'ok',
    content: { rules, doc },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */

function errorOut(blockId, type, message) {
  return { blockId, type, status: 'error', content: {}, error: message };
}

function stringOr(v, fallback) {
  return typeof v === 'string' ? v : fallback;
}

function clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'number' && Number.isFinite(v) ? (v | 0) : fallback;
  return Math.max(lo, Math.min(hi, n));
}
