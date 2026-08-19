/**
 * basis v2 — task-store item → Stream-row mapping (shared web≡mobile).
 *
 * The circle "Taken" tab lists a circle's tasks (from the composed tasks
 * agent's `listOpen`) and surfaces each task's lifecycle actions.  Those
 * actions are chosen by the SAME `actionsForStreamRow` selector the chat
 * stream uses (invariant #1/#3 — logic lives once), so a task item must be
 * projected into the stream-row shape that selector reads.
 *
 * The mandate ("Toevertrouwen" / entrust) action is appended by
 * `actionsForStreamRow` for a task-like row's OWNER; it reads the
 * first-class `taskId` + `addedBy` this projection stamps, so the owner
 * check is deterministic (not payload-rummaging).
 *
 * Lifecycle → chip-set: `actionsForStreamRow`'s KIND_CHIPS has no `task`
 * entry by design (a bare `task` row offers only the owner mandate — pinned
 * by streamActions.test.js).  So we map the task's lifecycle STATE to the
 * existing chip-bearing task-like kind whose chips ARE the task's next
 * action:
 *   open    → 'chore'    → [claim, snooze]  (+ owner mandate)
 *   claimed → 'reminder' → [done,  snooze]  (+ owner mandate)
 *   other   → 'task'     → [] of its own    (+ owner mandate)
 * Both `chore` and `reminder` are MANDATE_KINDS, so the owner mandate rides
 * along in every state.  The REAL status is carried separately (`status`)
 * for display — the Taken tab shows the true state, never the mapped kind.
 */

/** task lifecycle state → the stream-row kind whose chips match the next action. */
const STATE_TO_KIND = { open: 'chore', claimed: 'reminder' };

/** The task's lifecycle state (tasks-v0 uses `state`; some shapes use `status`). */
export function taskStatusOf(item) {
  const it = item && typeof item === 'object' ? item : {};
  const s = it.state ?? it.status;
  return typeof s === 'string' && s ? s : 'open';
}

/**
 * Project ONE task-store item into the stream-row shape `actionsForStreamRow`
 * reads, carrying first-class `taskId` + `addedBy` (owner-check provenance)
 * plus `text` / `status` / `assignee` for the tasks tab render.
 *
 * @param {object} item      a tasks `listOpen` item (`{id, text|title, state|status, assignee, addedBy, ...}`)
 * @param {{circleId?: string|null}} [ctx]
 * @returns {object} a stream row: `{id, circleId, type, taskId, addedBy, status, assignee, text, event}`
 */
export function taskItemToStreamRow(item, { circleId = null } = {}) {
  const it = item && typeof item === 'object' ? item : {};
  const taskId  = it.id ?? it.taskId ?? it.ref ?? null;
  const text    = it.text ?? it.title ?? it.label ?? '';
  const status  = taskStatusOf(it);
  const assignee = it.assignee ?? null;
  const addedBy = it.addedBy ?? it.master ?? it.creator ?? it.author ?? null;
  const kind    = STATE_TO_KIND[String(status).toLowerCase()] ?? 'task';
  return {
    id:       taskId != null ? `task-${taskId}` : 'task-row',
    circleId: circleId ?? it.circleId ?? null,
    type:     kind,
    // First-class provenance the mandate owner-check prefers (streamActions.js).
    taskId,
    addedBy,
    // Display fields (the true state, not the mapped chip-kind).
    status,
    assignee,
    text,
    event: { type: kind, payload: { kind, text, ref: taskId, taskId, addedBy, status, assignee } },
  };
}

/**
 * Project a list of task-store items into tasks tab stream rows.
 * @param {Array<object>} items
 * @param {{circleId?: string|null}} [ctx]
 * @returns {Array<object>}
 */
export function buildTaskRows(items, { circleId = null } = {}) {
  return (Array.isArray(items) ? items : []).map((it) => taskItemToStreamRow(it, { circleId }));
}
