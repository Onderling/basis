/**
 * DAG helpers — pure functions for task-graph state queries.
 *
 * Lifted from `apps/tasks-v0/src/dag.js` (Standardisation Phase
 * 52.6.2) so multiple apps can share the same DAG semantics. The
 * tasks-v0 module becomes a re-export shim.
 *
 * Naming note: item-store also ships a substrate-level
 * `computeStatus(item)` (lifecycle: open/claimed/submitted/...). That
 * one stays in `ItemStore.js`. The function here is the **DAG-aware**
 * status (ready/waiting/blocked) and ships as `computeDagStatus` to
 * avoid the name collision. `effectiveStatus` combines both.
 */

/**
 * DAG status given a task plus the open/closed sets of every other
 * task. Pure; no substrate dependency.
 *
 * @param {object} task
 * @param {object[]} openItems
 * @param {object[]} closedItems
 * @returns {'ready'|'waiting'|'blocked'}
 */
export function computeDagStatus(task, openItems, closedItems) {
  if (!task?.dependencies || task.dependencies.length === 0) return 'ready';
  const openIds   = new Set(openItems.map((t) => t.id));
  const closedIds = new Set(closedItems.map((t) => t.id));
  let waiting = false;
  for (const depId of task.dependencies) {
    if (closedIds.has(depId)) continue;           // satisfied
    if (openIds.has(depId)) { waiting = true; continue; }
    return 'blocked';
  }
  return waiting ? 'waiting' : 'ready';
}

/**
 * Effective status — DoD-lifecycle (from `reviewLog` / `assignee` /
 * `completedAt`) UNION DAG state.
 *
 * Order of precedence:
 *   1. `completedAt`             → 'complete'
 *   2. last reviewLog == submit  → 'submitted'
 *   3. last reviewLog == reject  → 'rejected'
 *   4. `assignee` set            → 'claimed'
 *   5. fallback to DAG status (`ready` | `waiting` | `blocked`)
 *
 * Lifecycle wins over DAG: a claimed-but-deps-blocked task reports
 * `'claimed'`, not `'waiting'`. To gate UI affordances on
 * deps-state separately, use `unmetDeps`.
 *
 * @returns {'ready'|'waiting'|'blocked'|'claimed'|'submitted'|'rejected'|'complete'}
 */
export function effectiveStatus(task, openItems, closedItems) {
  if (!task) return 'ready';
  if (task.completedAt) return 'complete';
  // A PROVISIONAL subtask (spawned optimistically under a pending claim) reads distinctly — it is not yet
  // committed and does not gate its parent (the subtask decentralized-tree fix, §2.5).
  if (task.provisional === true) return 'provisional';
  const log  = Array.isArray(task.reviewLog) ? task.reviewLog : [];
  const last = log[log.length - 1]?.decision ?? null;
  if (last === 'submit') return 'submitted';
  if (last === 'reject') return 'rejected';
  if (task.assignee) {
    // An EXPLICIT-confirm task whose claim is not yet ratified reads as pending — the master's confirmation
    // is what turns it into a real 'claimed'. Auto-confirm (the default) sets `confirmedAssignee` on claim, so
    // it stays 'claimed' — no existing behaviour changes.
    return (task.claimConfirmation === 'explicit' && !task.confirmedAssignee) ? 'pending-confirmation' : 'claimed';
  }
  return computeDagStatus(task, openItems, closedItems);
}

/**
 * Open dep IDs — refs in `task.dependencies` not present in
 * `closedItems`. Mirror of the substrate's `DependenciesOpenError`
 * pre-check, exposed read-side so the UI can pre-disable
 * "Mark complete" / "Approve" without round-tripping.
 *
 * @returns {string[]}
 */
export function unmetDeps(task, openItems, closedItems) {
  if (!task?.dependencies || task.dependencies.length === 0) return [];
  void openItems;   // accepted for symmetric API; not consulted (parity with tasks-v0).
  const closedIds = new Set(closedItems.map((t) => t.id));
  const out = [];
  for (const depId of task.dependencies) {
    if (!closedIds.has(depId)) out.push(depId);
  }
  return out;
}

/**
 * Cycle detection. Returns `null` when no cycle, or the cycle path
 * as `string[]` of task ids.
 */
export function detectCycle(task, allTasks) {
  if (!task?.dependencies || task.dependencies.length === 0) return null;
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  byId.set(task.id, task);
  const visiting = new Set();
  const visited  = new Set();

  function walk(id, path) {
    if (visiting.has(id)) {
      const ix = path.indexOf(id);
      return ix === -1 ? [...path, id] : path.slice(ix).concat(id);
    }
    if (visited.has(id)) return null;
    const t = byId.get(id);
    if (!t) return null;
    visiting.add(id);
    for (const dep of t.dependencies ?? []) {
      const cycle = walk(dep, [...path, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  return walk(task.id, []);
}
