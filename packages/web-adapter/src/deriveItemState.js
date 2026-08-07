/**
 * deriveItemState — derives the lifecycle state of a generic item.
 *
 * V0 lifecycle (used by household lists — shopping, errand, repair,
 * schedule):
 *   'open' | 'complete' | 'removed'
 *
 * DoD lifecycle (used by tasks-v0 tasks):
 *   'open' | 'claimed' | 'submitted' | 'rejected' | 'complete' | 'removed'
 *
 * The original `apps/household/web/main.js` helper only derived
 * open|complete|removed and didn't handle DoD lifecycle (flagged
 * by the A.3 agent). This shared helper subsumes both — the
 * task-status pattern is taken from `apps/tasks-v0/src/ui/taskStatus.js`
 * (the source-of-truth for the DoD-lifecycle state machine, shared
 * with tasks-mobile). We pull just the lifecycle derivation here;
 * `describeTaskStatus` keeps the deps-gate + colourKey
 * derivation, which belongs to the tasks-only path.
 *
 * Discipline:
 *   - Pure: no DOM, no `Date.now()`, no globals.
 *   - Returns a string. `'open'` is the fallback (matches both V0 and
 *     conventions — claim is the first state-changing op, until
 *     then a task is "open").
 *   - Honours item.status when it is one of the substrate-canonical
 *     enum strings (the tasks-v0 listOpen skill stamps this — it is
 *     the effective status: lifecycle ∪ DAG). Falls back to the
 *     reviewLog → assignee → completedAt derivation when not.
 *
 * @param {object} item
 * @returns {'open'|'claimed'|'submitted'|'rejected'|'complete'|'removed'|'ready'|'waiting'|'blocked'}
 */
export function deriveItemState(item) {
  if (!item || typeof item !== 'object') return 'open';

  // Honour an explicit lifecycle status if the substrate stamped one
  // (tasks-v0's listOpen / listMine return effectiveStatus already).
  // We accept the full StatusKind alphabet from taskStatus.js so the
  // appliesTo gates in the manifest (which use enum strings) work
  // against both list-skill outputs AND raw store items uniformly.
  if (typeof item.status === 'string' && _KNOWN.has(item.status)) {
    return item.status;
  }

  if (item.completedAt) return 'complete';
  if (item.removedAt)   return 'removed';
  if (item.provisional === true) return 'provisional';   // optimistic subtask (subtask decentralized-tree fix)

  // DoD lifecycle — reviewLog wins over assignee.
  // reviewLog: [{decision:'submit'|'reject'|'approve', by, at, note?}]
  const log = Array.isArray(item.reviewLog) ? item.reviewLog : [];
  const last = log.length > 0 ? log[log.length - 1]?.decision : null;
  if (last === 'submit') return 'submitted';
  if (last === 'reject') return 'rejected';

  if (item.assignee) {
    // Explicit-confirm task, claim not yet ratified → pending; else claimed (auto-confirm sets confirmedAssignee).
    return (item.claimConfirmation === 'explicit' && !item.confirmedAssignee) ? 'pending-confirmation' : 'claimed';
  }
  return 'open';
}

const _KNOWN = new Set([
  'open',
  'ready',
  'waiting',
  'blocked',
  'claimed',
  'pending-confirmation',
  'provisional',
  'submitted',
  'rejected',
  'complete',
  'removed',
]);
