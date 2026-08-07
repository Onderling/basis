/**
 * dag-tree — pure helpers for the sub-task hierarchy (Tasks V1
 * Phase 7).
 *
 * The subtask tree edge is the item-store CONTAINMENT model — `containedBy`
 * on the CHILD (the one conflict-free edge; the parent's forward `embeds`
 * are written only by the confirmed claimant, so they never clobber). This
 * module gives the app + UI ergonomic ways to walk parent / child chains:
 *
 *   - `childrenOf(parentId, allTasks)`     — direct children
 *   - `treeOf(rootId, allTasks)`           — recursive tree {id, item, children}
 *   - `ancestorChain(taskId, allTasks)`    — [root, ..., parent, self]
 *   - `depthOf(taskId, allTasks)`          — number of ancestors (top = 0)
 *   - `wouldCreateParentCycle(parentId,    — would a `parent → newChild`
 *      newChildId, allTasks)`                 edge introduce a cycle?
 *
 * Pure functions — no I/O. Apps pass the current open + closed item
 * lists (typically `await store.listOpen() + await store.listClosed()`).
 *
 * The subtask edge is CONTAINMENT (`containedBy`) — every spawn path writes it. (The legacy `parentTaskId`
 * tree field is retired; no writer sets it. `parentTaskId` survives only as an ARGUMENT name — "the parent
 * task's id" — and as a field on a subtask-REQUEST blob naming which parent it targets, neither of which is a
 * stored tree edge.)
 *
 * Cycle detection note: the existing `detectCycle` in `dag.js` walks
 * `dependencies` and will catch most parent-chain cycles. This module
 * adds a parallel parent-chain walk for safety + early rejection on
 * the spawn path.
 */

/** Index `allTasks` by id for O(1) lookups. */
function _byId(allTasks) {
  const m = new Map();
  for (const t of allTasks ?? []) {
    if (t?.id) m.set(t.id, t);
  }
  return m;
}

/**
 * The parent ids of a task — the CONTAINMENT edge (`containedBy`, may be multi-parent). The subtask TREE walk
 * uses the first parent.
 * @param {object} item
 * @returns {string[]}
 */
function _parentIdsOf(item) {
  if (Array.isArray(item?.containedBy) && item.containedBy.length) {
    return item.containedBy.filter((p) => typeof p === 'string' && p);
  }
  return [];
}

/** True iff `item` is a direct child of `parentId` under either edge. */
function _isChildOf(item, parentId) {
  return _parentIdsOf(item).includes(parentId);
}

/**
 * Direct children of `parentId`.
 *
 * @param {string} parentId
 * @param {Array<object>} allTasks
 * @returns {Array<object>}
 */
export function childrenOf(parentId, allTasks) {
  if (typeof parentId !== 'string' || !parentId) return [];
  return (allTasks ?? []).filter((t) => _isChildOf(t, parentId));
}

/**
 * Recursive tree rooted at `rootId`. Each node is
 * `{ id, item, children: [...] }`. Returns null if `rootId` not found.
 *
 * @param {string} rootId
 * @param {Array<object>} allTasks
 * @returns {{id: string, item: object, children: Array} | null}
 */
export function treeOf(rootId, allTasks) {
  const ix = _byId(allTasks);
  const root = ix.get(rootId);
  if (!root) return null;
  return _build(root, ix, new Set());
}

function _build(item, ix, seen) {
  if (seen.has(item.id)) {
    // Defensive: data integrity bug should be impossible after
    // wouldCreateParentCycle, but if it ever happens we cut the
    // walk rather than recurse forever.
    return { id: item.id, item, children: [], cycle: true };
  }
  seen.add(item.id);
  const children = [];
  for (const child of ix.values()) {
    if (_isChildOf(child, item.id)) {
      children.push(_build(child, ix, seen));
    }
  }
  return { id: item.id, item, children };
}

/**
 * Ancestor chain: `[root, ..., parent, self]`. If the task has no
 * containment parent, returns `[self]`. If a parent id references
 * a missing item, the chain stops there.
 *
 * @param {string} taskId
 * @param {Array<object>} allTasks
 * @returns {Array<object>}
 */
export function ancestorChain(taskId, allTasks) {
  const ix = _byId(allTasks);
  const self = ix.get(taskId);
  if (!self) return [];
  const out = [self];
  let cursor = self;
  const seen = new Set([self.id]);
  // Walk the FIRST parent up the chain (the subtask tree is single-parent even though containment allows many).
  let parentId = _parentIdsOf(cursor)[0];
  while (parentId) {
    if (seen.has(parentId)) break;
    const next = ix.get(parentId);
    if (!next) break;
    out.unshift(next);
    seen.add(next.id);
    cursor = next;
    parentId = _parentIdsOf(cursor)[0];
  }
  return out;
}

/**
 * Depth = number of ancestors. Top-level task = 0; direct child = 1;
 * grandchild = 2; etc.
 *
 * @param {string} taskId
 * @param {Array<object>} allTasks
 * @returns {number}
 */
export function depthOf(taskId, allTasks) {
  const chain = ancestorChain(taskId, allTasks);
  return Math.max(0, chain.length - 1);
}

/**
 * Would adding `parent → newChild` create a parent-chain cycle?
 *
 * Used when spawning a sub-task: if `newChildId` is already an
 * ancestor of `parentId`, the spawn would form a cycle. Returns the
 * cycle path (newest at the end) for friendly error messages, or
 * `null` if no cycle.
 *
 * `newChildId` may not yet exist in `allTasks` — we only check the
 * existing parent chain. The cycle-via-dependencies path is covered
 * by `dag.js#detectCycle` separately.
 *
 * @param {string} parentId
 * @param {string} newChildId
 * @param {Array<object>} allTasks
 * @returns {Array<string> | null}
 */
export function wouldCreateParentCycle(parentId, newChildId, allTasks) {
  if (typeof parentId !== 'string' || typeof newChildId !== 'string') return null;
  if (parentId === newChildId) return [parentId, newChildId];
  const chain = ancestorChain(parentId, allTasks).map((t) => t.id);
  if (chain.includes(newChildId)) {
    return [...chain, newChildId];
  }
  return null;
}
