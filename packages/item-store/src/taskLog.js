/**
 * taskLog — the task store's transitions AS AN APPEND-ONLY EVENT LOG.
 *
 * The record decision, executed for tasks. This mirrors the governance log
 * (`apps/basis/src/v2/governanceLog.js`) one layer DOWN — in the substrate — so every
 * task-consuming app (basis · stoop · household · tasks-v0) shares ONE record instead
 * of each re-deriving sync. A transition is a typed ENTRY; the store row is the
 * materialised HEAD of replaying those entries.
 *
 * ── Why this fixes the "tasks sometimes don't arrive" bug ────────────────────────────
 * The old store-mirror sync (`createTaskStore.applySync`) only UPDATES an item that
 * already has a LOCAL mirror — it starts by finding the local row and returns null when
 * there is none. So a task created on device A never lands on a device C that never saw
 * it (the classic three-device gap). A `create` ENTRY replayed on C produces the task by
 * construction, whether or not it was ever there.
 *
 * ── No lifecycle logic is re-implemented here (logic lives once) ─────────────────────
 * `applyTaskEntry` REPLAYS an entry through the SAME lifecycle/CRUD verbs the live store
 * uses, so the head it materialises is identical to the live store by construction. The
 * only thing this module owns is the entry SHAPE, its stable id, and the verb dispatch.
 */

import { addTasks, update, removeItems } from './taskCrud.js';
import { claim, reassign, markComplete, submit, approve, reject, revoke } from './taskLifecycle.js';

/** The wire/log kind — already registered in `entryKinds.js` as a human-facing, waking kind. */
export const TASK_LOG_KIND = 'task';

export const TASK_EVENT = Object.freeze({
  CREATE: 'create', CLAIM: 'claim', REASSIGN: 'reassign', COMPLETE: 'complete',
  SUBMIT: 'submit', APPROVE: 'approve', REJECT: 'reject', REVOKE: 'revoke',
  UPDATE: 'update', REMOVE: 'remove',
});

// ── entry constructors — each captures the verb + EXACTLY the args a replay needs ─────
const base = (event, taskId, by, at) => ({ kind: TASK_LOG_KIND, event, taskId, by, at: at ?? 0 });

/** `item` is the created task itself — replayed through `addTasks`, whose `materialise`
 *  preserves a provided `id`, so every device reconstructs the SAME task deterministically. */
export const createTaskEvent   = ({ taskId, by, at, item })   => ({ ...base(TASK_EVENT.CREATE, taskId, by, at), item });
export const claimTaskEvent    = ({ taskId, by, at })         => base(TASK_EVENT.CLAIM, taskId, by, at);
export const reassignTaskEvent = ({ taskId, by, at, to })     => ({ ...base(TASK_EVENT.REASSIGN, taskId, by, at), to });
export const completeTaskEvent = ({ taskId, by, at, reason }) => ({ ...base(TASK_EVENT.COMPLETE, taskId, by, at), ...(reason ? { reason } : {}) });
export const submitTaskEvent   = ({ taskId, by, at, args })   => ({ ...base(TASK_EVENT.SUBMIT, taskId, by, at), args: args ?? null });
export const approveTaskEvent  = ({ taskId, by, at, args })   => ({ ...base(TASK_EVENT.APPROVE, taskId, by, at), args: args ?? null });
export const rejectTaskEvent   = ({ taskId, by, at, args })   => ({ ...base(TASK_EVENT.REJECT, taskId, by, at), args: args ?? null });
export const revokeTaskEvent   = ({ taskId, by, at, args })   => ({ ...base(TASK_EVENT.REVOKE, taskId, by, at), args: args ?? null });
export const updateTaskEvent   = ({ taskId, by, at, patch })  => ({ ...base(TASK_EVENT.UPDATE, taskId, by, at), patch: patch ?? {} });
export const removeTaskEvent   = ({ taskId, by, at })         => base(TASK_EVENT.REMOVE, taskId, by, at);

/**
 * A STABLE id for a task entry, so the local append and any fanned/received copy
 * collapse to the same entry (dedup by id). Mirrors `governanceEntryId`: identity is
 * the tuple that a re-delivery of the SAME transition shares.
 */
export function taskEntryId(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return `task:${entry.taskId ?? ''}:${entry.event ?? ''}:${entry.by ?? ''}:${entry.at ?? ''}`;
}

/**
 * Is this entry worth NUDGING an offline member about? A task APPEARING (create) or
 * being handed to someone (reassign) is; routine status churn (submit/approve/…) is not.
 * The wake-gate reads this, mirroring `governanceWakeHint`.
 */
export function taskWakeHint(entry) {
  return !!entry && (entry.event === TASK_EVENT.CREATE || entry.event === TASK_EVENT.REASSIGN);
}

/** Map a task event → the `createTaskStore` parity event name (`item-added` / `item-claimed` / …). */
export function taskEventName(event) {
  switch (event) {
    case TASK_EVENT.CREATE:   return 'item-added';
    case TASK_EVENT.CLAIM:    return 'item-claimed';
    case TASK_EVENT.REASSIGN: return 'item-reassigned';
    case TASK_EVENT.COMPLETE: return 'item-completed';
    case TASK_EVENT.SUBMIT:   return 'item-submitted';
    case TASK_EVENT.APPROVE:  return 'item-approved';
    case TASK_EVENT.REJECT:   return 'item-rejected';
    case TASK_EVENT.REVOKE:   return 'item-revoked';
    case TASK_EVENT.REMOVE:   return 'item-removed';
    default:                  return 'item-updated';
  }
}

/**
 * REPLAY one entry against a store, through the real verbs — gate-bypassed (no
 * `rolePolicy`: the origin already gated the action) and DAG-bypassed (no
 * `enforceDependencies`: the origin already enforced closure, and an out-of-order
 * arrival must not re-block). Returns the verb result.
 *
 * The store passed in should SUPPRESS the publish-on-write fan-out (an ingest must not
 * echo the item back to the mesh) — `createTaskStore.applyLogEntry` passes a `sync:false`
 * proxy for exactly that, the same discipline `applySync` uses.
 *
 * @param {object} store  a CircleItemStore-shaped write surface (get/list/put/putIfMatch/delete)
 * @param {object} entry  a task-log entry (see the constructors above)
 */
export async function applyTaskEntry(store, entry) {
  if (!entry || entry.kind !== TASK_LOG_KIND || typeof entry.taskId !== 'string') return null;
  const ctx = { actor: entry.by };   // no rolePolicy → `gate()` is a no-op (allow); no enforceDependencies
  switch (entry.event) {
    case TASK_EVENT.CREATE:   return addTasks(store, [entry.item], ctx);
    case TASK_EVENT.CLAIM:    return claim(store, entry.taskId, ctx);
    case TASK_EVENT.REASSIGN: return reassign(store, entry.taskId, entry.to, ctx);
    case TASK_EVENT.COMPLETE: return markComplete(store, [entry.taskId], { ...ctx, reason: entry.reason });
    case TASK_EVENT.SUBMIT:   return submit(store, entry.taskId, entry.args, ctx);
    case TASK_EVENT.APPROVE:  return approve(store, entry.taskId, entry.args, ctx);
    case TASK_EVENT.REJECT:   return reject(store, entry.taskId, entry.args, ctx);
    case TASK_EVENT.REVOKE:   return revoke(store, entry.taskId, entry.args, ctx);
    case TASK_EVENT.UPDATE:   return update(store, entry.taskId, entry.patch, ctx);
    case TASK_EVENT.REMOVE:   return removeItems(store, [entry.taskId], ctx);
    default:                  return null;
  }
}
