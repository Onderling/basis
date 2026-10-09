/**
 * basis v2 — circle content loader (shared web + mobile, F1 / 0.5b).
 *
 * Populates a circle's detail view with its items, reusing EXISTING
 * list ops (no new ops): bulletin/feed posts, tasks, notes. Best-effort
 * and fault-tolerant — a missing/erroring op contributes nothing. The
 * circle id is passed as args (so ops that scope server-side do), and
 * results are scoped client-side via the same rule as `scopeItems`:
 * keep items whose circle hint matches, plus items with no per-item
 * hint (assume the op already scoped them).
 *
 * Wiring status (as of 5.3d, 2026-05-30):
 *   - getBulletin → stoop.listOpen (alias in realAgent.STOOP_OP_ALIAS).
 *     Posts created in basis carry the active circle id under
 *     `source.targets[]`; the listOpen adapter surfaces that as a
 *     top-level `groupId` so `keepForCircle` can separate circles.
 *   - getFeed — ASPIRATIONAL.  Deliberately NOT aliased — would route
 *     to the same stoop.listOpen as getBulletin and duplicate every
 *     post in the flat result.  Kept in DEFAULT_SOURCES so a future
 *     dedicated feed substrate (separate from bulletin posts) can
 *     wire it without a contract change.
 *   - getMyTasks → tasks-v0.listOpen (5.3b, via TASKS_OP_ALIAS).
 *   - the circle's notes → household's `note` noun, its generic list op
 *     (people-written: what the circle's people wrote down for everyone to
 *     know; the noun's CRUD comes free from its manifest declaration).
 */
import { isInCircle } from './circleScope.js';
import { encodeGenericOpId } from '@onderling/app-manifest';

const DEFAULT_SOURCES = [
  { op: 'getBulletin', kind: 'post', pick: (r) => r?.posts ?? r?.bulletin ?? r?.items },
  { op: 'getFeed',     kind: 'post', pick: (r) => r?.feed ?? r?.items },
  { op: 'getMyTasks',  kind: 'task', pick: (r) => r?.tasks ?? r?.items },
  { op: encodeGenericOpId('household', 'list', 'note'), kind: 'note', pick: (r) => r?.notes ?? r?.items },
];

export function normalizeContentItem(raw = {}, kind = null) {
  const id = raw.id ?? raw.taskId ?? raw.postId ?? raw.noteId ?? null;
  return {
    id,
    label: raw.title ?? raw.text ?? raw.name ?? raw.summary ?? (id != null ? String(id) : ''),
    kind: raw.kind ?? kind ?? null,
    circleId: raw.circleId,
    circleId: raw.circleId,
    groupId: raw.groupId,
    audience: raw.audience,
  };
}

function keepForCircle(item, circleId) {
  if (!circleId) return true;
  const hasHint =
    item.circleId != null || item.circleId != null || item.groupId != null || item.audience != null;
  if (!hasHint) return true; // op already scoped via args — trust it
  return isInCircle(item, circleId);
}

export async function loadCircleItems({ callSkill, circleId, sources = DEFAULT_SOURCES } = {}) {
  if (typeof callSkill !== 'function') return [];
  const args = circleId ? { circleId, groupId: circleId } : {};
  const lists = await Promise.all(
    sources.map(async (s) => {
      try {
        const res = await callSkill(s.op, args);
        const arr = s.pick(res);
        return Array.isArray(arr) ? arr.map((r) => normalizeContentItem(r, s.kind)) : [];
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().filter((it) => keepForCircle(it, circleId));
}
