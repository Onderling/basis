/**
 * taskDetail — portable helpers for the per-task detail surface.
 *
 * Web parity for tasks-mobile's `TaskDetailScreen.jsx`. The web page
 * (`apps/tasks-v0/web/task.html`) and the mobile screen share:
 *
 *   - URL/route-param parsing → `?taskId=t-123` ↔ `{taskId}`
 *   - findTaskById            → walk listOpen + listClosed for the
 *                                matching id (mirror of mobile's
 *                                `useMemo` over listOpen items)
 *   - role + actor derivation → `effectiveActor.resolveActorRole`
 *                                already lives in `./effectiveActor.js`;
 *                                this file consumes it.
 *   - state-machine of action buttons → which CTAs surface for
 *                                a given `(task, actor, role)` triple.
 *   - appeal-eligibility heuristic    → last reviewLog entry is a
 *                                       revoke (the substrate gates the
 *                                       eligibility window itself).
 *   - reviewLog formatter             → flatten an entry into a single
 *                                       displayable line for the
 *                                       history timeline.
 *
 * Pure-fn only — no DOM, no react-native. Mirrors `chatThread.js` and
 * `taskStatus.js` conventions: served at `/lib/taskDetail.js` by
 * `bin/tasks-ui.js` so `task.html` can ESM-import the same module the
 * mobile screen consumes.
 */

import { describeTaskStatus } from './taskStatus.js';

/**
 * Parse a URLSearchParams-compatible source into the task-page route
 * params. Tolerant of `URLSearchParams`, plain objects, and `null`.
 * Returns `null` when taskId is missing so callers can render a
 * no-task error state.
 *
 * @param {URLSearchParams | object | null | undefined} input
 * @returns {{taskId: string} | null}
 */
export function parseTaskLocation(input) {
  if (input == null) return null;
  const get = (k) => {
    if (typeof input.get === 'function') {
      const v = input.get(k);
      return typeof v === 'string' ? v : null;
    }
    const v = input[k];
    return typeof v === 'string' ? v : null;
  };
  const taskId = get('taskId');
  if (typeof taskId !== 'string' || !taskId) return null;
  return { taskId };
}

/**
 * Find a task by id across an open + closed list. Mirrors mobile's
 * `useMemo` over listOpen items but extended to also peek `listClosed`
 * for tasks that have moved into the complete/rejected state (same
 * pattern the desktop's task-detail modal uses).
 *
 * @param {string} taskId
 * @param {{open?: Array<object>, closed?: Array<object>}} sources
 * @returns {object | null}
 */
export function findTaskById(taskId, { open, closed } = {}) {
  if (typeof taskId !== 'string' || !taskId) return null;
  const openArr   = Array.isArray(open)   ? open   : [];
  const closedArr = Array.isArray(closed) ? closed : [];
  return openArr.find((it) => it?.id === taskId)
      ?? closedArr.find((it) => it?.id === taskId)
      ?? null;
}

/**
 * Decide whether the most-recent reviewLog entry is a revoke (which
 * gates whether the Appeal CTA renders). Mirrors mobile's `offerAppeal`
 * branch in TaskDetailScreen. The substrate further gates eligibility
 * (caller-was-prev-assignee + ≤ 7-day window); the UI is permissive
 * and surfaces the affordance whenever a revoke happened.
 *
 * @param {object | null} task
 * @returns {boolean}
 */
export function lastReviewWasRevoke(task) {
  if (!task) return false;
  const log = Array.isArray(task.reviewLog) ? task.reviewLog : [];
  if (log.length === 0) return false;
  return log[log.length - 1]?.decision === 'revoke';
}

/**
 * Derive the per-state button visibility for a given (task, actor,
 * role) triple. Mirrors mobile's TaskDetailScreen render-branch matrix.
 *
 * Returned shape (every value is a boolean):
 *   - canClaim          — show "Claim"        (status=ready, unassigned)
 *   - canSubmit         — show "Submit"       (assignee, status=claimed|rejected, approval !== self-mark)
 *   - canMarkComplete   — show "Mark complete" (assignee, status=claimed, approval === self-mark)
 *   - canApproveReject  — show "Approve" / "Reject" (approver, status=submitted)
 *   - canEdit           — show "Edit"         (status in ready|waiting|blocked|claimed; author OR admin/coord)
 *   - canRevoke         — show "Revoke"       (master/admin/coord; status=claimed|submitted|rejected)
 *   - canReassign       — show "Reassign"    (admin/coord)
 *   - canRemove         — show "Remove"       (admin only)
 *   - canAppeal         — show "Appeal"       (last reviewLog entry is a revoke)
 *   - canForceComplete  — show "Force complete" (admin/coord with open deps)
 *
 * @param {object | null} task    item shape from listOpen / listClosed
 * @param {string | null} actor   caller's webid (already resolved)
 * @param {string | null} role    'admin' | 'coordinator' | 'member' | ...
 * @returns {{
 *   canClaim: boolean,
 *   canSubmit: boolean,
 *   canMarkComplete: boolean,
 *   canApproveReject: boolean,
 *   canEdit: boolean,
 *   canRevoke: boolean,
 *   canReassign: boolean,
 *   canRemove: boolean,
 *   canAppeal: boolean,
 *   canForceComplete: boolean,
 * }}
 */
export function deriveTaskActions(task, actor, role) {
  const out = {
    canClaim:         false,
    canSubmit:        false,
    canMarkComplete:  false,
    canApproveReject: false,
    canEdit:          false,
    canRevoke:        false,
    canReassign:      false,
    canRemove:        false,
    canAppeal:        false,
    canForceComplete: false,
  };
  if (!task) return out;
  const status      = describeTaskStatus(task);
  const kind        = status.kind;
  const isAdminish  = role === 'admin' || role === 'coordinator';
  const isAdminOnly = role === 'admin';
  const isAssignee  = typeof actor === 'string' && actor === task.assignee;
  const isMaster    = typeof actor === 'string' &&
                       (actor === task.master || actor === task.addedBy);
  const approval    = task.approval ?? 'self-mark';
  const isApprover  = isAdminish
    || (approval === 'creator'  && isMaster)
    || (approval === 'self-mark' && isAssignee)
    || (typeof approval === 'string' && approval.startsWith('webid:')
        && approval.slice('webid:'.length) === actor);

  // Claim — unassigned + status ready (mobile gates on `kind==='ready'`).
  out.canClaim = kind === 'ready' && !task.assignee;

  // Submit / Mark complete — assignee, claimed (or rejected for re-submit).
  if (isAssignee && (kind === 'claimed' || kind === 'rejected')) {
    if (approval === 'self-mark' && kind === 'claimed') {
      out.canMarkComplete = true;
    } else {
      out.canSubmit = true;
    }
  }

  // Approve / Reject — approver + submitted.
  out.canApproveReject = kind === 'submitted' && isApprover;

  // Edit — author or admin/coord, while the body is still mutable.
  // (Mobile's gate is `status.kind === ready|waiting|blocked|claimed`
  //  plus the substrate's editTask role check; we surface the CTA
  //  for the same set + author-or-admin.)
  out.canEdit = (isMaster || isAdminish)
    && (kind === 'ready' || kind === 'waiting'
        || kind === 'blocked' || kind === 'claimed');

  // Admin / master overrides.
  out.canRevoke = (isMaster || isAdminish)
    && (kind === 'claimed' || kind === 'submitted' || kind === 'rejected');
  out.canReassign = isAdminish && kind !== 'complete';
  out.canRemove   = isAdminOnly;

  // Appeal — last reviewLog entry is a revoke (substrate gates the rest).
  out.canAppeal = lastReviewWasRevoke(task);

  // Force-complete — admin/coord override when the deps gate would
  // block close. Reuses the same predicate as the list pages.
  out.canForceComplete = isAdminish && status.depsBlocked && kind !== 'complete';

  return out;
}

/**
 * Format a single reviewLog entry as a human-readable string. Mirrors
 * mobile's `_formatReviewEntry` but locale-agnostic — the page's
 * `localised()` shim wraps the action label.
 *
 * @param {object | null} entry
 * @returns {{action: string, by: string, note: string, at: number|null}}
 */
export function formatReviewEntry(entry) {
  const action = typeof entry?.action === 'string' ? entry.action
               : typeof entry?.decision === 'string' ? entry.decision
               : '';
  const by   = typeof entry?.by === 'string' ? entry.by
             : typeof entry?.actor === 'string' ? entry.actor
             : '';
  const note = typeof entry?.note === 'string' ? entry.note : '';
  const at   = Number.isFinite(entry?.at) ? entry.at
             : Number.isFinite(entry?.timestamp) ? entry.timestamp
             : null;
  return { action, by, note, at };
}

/**
 * Trim a webid for display — keep the last path segment, cap at 14
 * chars + ellipsis. Mirrors mobile's `_suffix` (TaskDetailScreen) +
 * the chatThread shortWebid helper.
 *
 * @param {string | null | undefined} webid
 * @returns {string}
 */
export function shortWebid(webid) {
  if (typeof webid !== 'string') return '';
  const i = webid.lastIndexOf('/');
  const tail = i >= 0 ? webid.slice(i + 1) : webid;
  return tail.length > 14 ? `${tail.slice(0, 14)}…` : tail;
}
