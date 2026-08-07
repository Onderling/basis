/**
 * createTaskStore — the LIVE-app COMPATIBILITY SURFACE over the converged
 * `CircleItemStore` + the ported task functions (`taskLifecycle` / `taskCrud`).
 *
 * PLAN-capabilities-tasks-roles migration STEP 2 (the consumer swap).
 *
 * ── What this is (and is NOT) ────────────────────────────────────────────────
 * NOT a storage implementation. It is a THIN DELEGATION BUNDLE that re-creates
 * the method surface the class `ItemStore` exposed (`addItems` / `claim` /
 * `markComplete` / `listOpen` / … / `applySync` / `auditLog` / `on`), each method
 * delegating to the pure functions over an injected `CircleItemStore`, with the
 * per-store policy/flags (`rolePolicy`, `enforceDependencies`) threaded into the
 * function `ctx`. The point: the ~26 tasks-v0 call sites already call
 * `store.<method>(args, { actor, actorDisplayName })` — the EXACT ctx shape the
 * ported functions take — so the app migrates onto the converged store by
 * swapping ONE constructor, not rewriting call sites.
 *
 * ── The three seams the pure functions deliberately DON'T model ─────────────
 * The ported `taskLifecycle` / `taskCrud` functions are stateless and carry no
 * event/audit machinery (by design — see their module docs' TODO seams). The
 * class `ItemStore` did. This bundle supplies those seams at the app boundary so
 * the LIVE surface stays behaviourally identical:
 *   1. EVENTS — extends `Emitter`; each verb threads `ctx.emit` → `this.emit`, so
 *      the app's `store.on('item-added'|'item-completed', …)` subscribers still
 *      fire (Circle.js wires calendar/invoicing/subtask listeners this way).
 *   2. AUDIT — an in-memory append-only log; each verb records the same
 *      `{action, actor, actorDisplayName, at, details}` entry `ItemStore` did
 *      (add/claim/reassign/complete/submit/approve/reject/revoke/remove/update +
 *      the `sync-*` inbound entries). `auditLog(filter)` reads it (appeal.js +
 *      the audit-assertion tests depend on it).
 *   3. setApprovalMode — a dedicated approval-mode transition `ItemStore` had but
 *      that was not lifted to a pure function; re-implemented here over the store.
 *
 * ── applySync / removeSync (the inbound sync-ingest path) ────────────────────
 * `wireItemMirror` (@onderling/notify-envelope) ingests a peer's task via
 * `applySync({syncedFromId, nextState, action}, {remoteActor})` /
 * `removeSync({syncedFromId}, …)` — the gate-bypass inbound path. Mirroring
 * `ItemStore.applySync`: find the LOCAL item by its `source.syncedFromId` marker
 * (NOT its primary id — the local id was freshly minted on first receive),
 * MERGE `nextState` onto it preserving local identity (`id` / `createdAt` /
 * `createdBy` / the local `source` markers), then write via CircleItemStore's
 * CAUSAL `put({ origin:true, sync:false })`: `origin:true` preserves the payload's
 * origin clock so causal order survives transport + gates a causally-older
 * inbound out; `sync:false` suppresses the publish-on-write fan-out so an ingest
 * never echoes the item back to the mesh. No role-policy gate (inbound is
 * substrate-internal — parity with ItemStore).
 */

import { Emitter } from '@onderling/core';
import { ulid } from './ulid.js';
import { addTasks, listOpen, listClosed, getById, update, removeItems } from './taskCrud.js';
import { claim, confirmClaim, spawnSubtask, reassign, markComplete, submit, approve, reject, revoke } from './taskLifecycle.js';
import { requireActor, gate } from './taskCtx.js';
import { contain as containImpl } from './containment.js';
import { ItemNotFoundError, InvalidLifecycleError } from './errors.js';
import {
  TASK_LOG_KIND, applyTaskEntry, taskEntryId, taskEventName,
  createTaskEvent, claimTaskEvent, reassignTaskEvent, completeTaskEvent,
  submitTaskEvent, approveTaskEvent, rejectTaskEvent, revokeTaskEvent,
  updateTaskEvent, removeTaskEvent,
} from './taskLog.js';

/** Validate an ApprovalMode string — parity with `ItemStore`'s `_isApprovalMode`. */
function isApprovalMode(m) {
  if (typeof m !== 'string') return false;
  if (m === 'self-mark' || m === 'creator') return true;
  return m.startsWith('webid:') && m.length > 'webid:'.length;
}

/** Filter + stable-sort audit entries — parity with `ItemStore`'s `applyAuditFilter`. */
function applyAuditFilter(entries, filter) {
  if (!filter) return entries;
  let out = entries;
  if (filter.itemId) out = out.filter((e) => e.itemId === filter.itemId);
  if (filter.actor)  out = out.filter((e) => e.actor  === filter.actor);
  if (filter.action) out = out.filter((e) => e.action === filter.action);
  if (typeof filter.since === 'number') out = out.filter((e) => e.at >= filter.since);
  if (typeof filter.until === 'number') out = out.filter((e) => e.at <= filter.until);
  return out.sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : 1));
}

/** Map an inbound-sync action tag to the ItemStore-parity event name. */
function syncEventFor(action) {
  switch (action) {
    case 'claim':    return 'item-claimed';
    case 'complete': return 'item-completed';
    case 'submit':   return 'item-submitted';
    case 'approve':  return 'item-approved';
    case 'reject':   return 'item-rejected';
    case 'revoke':   return 'item-revoked';
    case 'reassign': return 'item-reassigned';
    default:         return 'item-updated';
  }
}

/**
 * Build the ItemStore-compatible task surface over a `CircleItemStore`.
 *
 * @param {import('./CircleItemStore.js').CircleItemStore} circleStore  the converged per-circle store.
 * @param {object} [opts]
 * @param {object} [opts.rolePolicy]           the `RolePolicy` gate (threaded into every verb's ctx).
 * @param {boolean} [opts.enforceDependencies] DAG close-gate (threaded into add/complete ctx).
 * @returns {object} an `Emitter`-backed bundle with ItemStore's method surface.
 */
export function createTaskStore(circleStore, { rolePolicy, enforceDependencies } = {}) {
  if (!circleStore || typeof circleStore.put !== 'function' || typeof circleStore.get !== 'function') {
    throw new Error('createTaskStore: a CircleItemStore (put/get/list) is required');
  }

  const emitter = new Emitter();
  /** @type {Array<object>} in-memory append-only audit log (parity with ItemStore's `<root>/audit/`). */
  const audit = [];

  /** @type {Array<object>} the task-log: every transition as a typed entry. This is the RECORD the
   *  cutover makes canonical — the store row is the materialised head of replaying these. */
  const logEntries = [];
  /** @type {Set<(entry: object) => void>} outbound-fan subscribers — the peer transport wires here. */
  const logSubs = new Set();
  /** @type {Set<string>} stable ids already folded — dedup so an idempotent re-delivery never double-applies. */
  const seenEntryIds = new Set();

  /** Append a transition to the task-log + notify the outbound fan. */
  function recordLog(entry) {
    if (!entry) return;
    logEntries.push(entry);
    seenEntryIds.add(taskEntryId(entry));
    for (const fn of logSubs) { try { fn(entry); } catch { /* fan is best-effort */ } }
  }

  /** A `sync:false` write proxy over the circle store — an INGEST replay must never echo the item
   *  back to the mesh (the same discipline `applySync` uses with `{origin:true, sync:false}`). */
  function ingestProxy(store) {
    return {
      get:        (id) => store.get(id),
      list:       () => store.list(),
      put:        (item, opts = {}) => store.put(item, { ...opts, sync: false }),
      putIfMatch: (item, opts = {}) => store.putIfMatch(item, { ...opts, sync: false }),
      delete:     (id, opts = {}) => store.delete(id, { ...opts, sync: false }),
    };
  }

  /** Record an audit entry (best-effort parity with `ItemStore#appendAudit`). */
  function appendAudit({ itemId, action, ctx = {}, actor, actorDisplayName, details, synced }) {
    const dn = actorDisplayName ?? ctx.actorDisplayName;
    const entry = {
      id: ulid(),
      itemId,
      action,
      actor: actor ?? ctx.actor ?? 'substrate',
      ...(dn ? { actorDisplayName: dn } : {}),
      at: Date.now(),
      ...(details && typeof details === 'object' && Object.keys(details).length > 0 ? { details } : {}),
      ...(synced ? { synced: true } : {}),
    };
    audit.push(entry);
  }

  /**
   * Thread the per-store policy/flags + the event seam into a call's ctx. `capture`
   * (optional) taps the emitted (name, payload) pairs so a verb can lift a detail
   * off its emit (e.g. revoke's `previousAssignee`) for the audit entry.
   */
  function mkCtx(ctx = {}, capture) {
    return {
      ...ctx,
      rolePolicy,
      enforceDependencies,
      emit: (name, payload) => {
        emitter.emit(name, payload);
        if (capture) capture(name, payload);
      },
    };
  }

  /** Find the local item mirroring a peer id via its `source.syncedFromId` marker. */
  async function findBySyncedFromId(syncedFromId) {
    const all = await circleStore.list();
    return all.find((i) => i?.source?.syncedFromId === syncedFromId) ?? null;
  }

  return {
    // ── Emitter surface (Circle.js subscribes: on/off/once) ──────────────────
    on:   (event, fn) => emitter.on(event, fn),
    off:  (event, fn) => emitter.off(event, fn),
    once: (event, fn) => emitter.once(event, fn),
    emit: (event, ...args) => emitter.emit(event, ...args),

    // ── CRUD + query (taskCrud) ──────────────────────────────────────────────
    addItems: async (partials, ctx = {}) => {
      const created = await addTasks(circleStore, partials, mkCtx(ctx));
      for (const item of created) {
        appendAudit({
          itemId: item.id,
          action: ctx.actionOverride ?? 'add',
          ctx,
          details: ctx.reason ? { reason: ctx.reason } : undefined,
        });
        recordLog(createTaskEvent({ taskId: item.id, by: ctx.actor ?? item.createdBy, at: item.addedAt ?? Date.now(), item }));
      }
      return created;
    },
    listOpen:   (filter) => listOpen(circleStore, filter),
    listClosed: (filter) => listClosed(circleStore, filter),
    getById:    (id) => getById(circleStore, id),
    update: async (id, patch, ctx = {}) => {
      const res = await update(circleStore, id, patch, mkCtx(ctx));
      appendAudit({ itemId: id, action: 'update', ctx, details: { fields: Object.keys(patch ?? {}) } });
      recordLog(updateTaskEvent({ taskId: id, by: ctx.actor, at: Date.now(), patch }));
      return res;
    },
    removeItems: async (refs, ctx = {}) => {
      const removed = await removeItems(circleStore, refs, mkCtx(ctx));
      for (const id of removed) {
        appendAudit({ itemId: id, action: 'remove', ctx });
        recordLog(removeTaskEvent({ taskId: id, by: ctx.actor, at: Date.now() }));
      }
      return removed;
    },

    // ── Lifecycle verbs (taskLifecycle) ──────────────────────────────────────
    claim: async (id, ctx = {}) => {
      const res = await claim(circleStore, id, mkCtx(ctx));
      if (!res?.error) {
        appendAudit({ itemId: id, action: 'claim', ctx });
        recordLog(claimTaskEvent({ taskId: id, by: ctx.actor, at: Date.now() }));
      }
      return res;
    },
    // Confirm a claim (subtask decentralized-tree fix) — the authority (master/admin via rolePolicy) turns a
    // pending claim into the real, subtree-unlocking one. `ctx.assignee` names the claim to confirm.
    confirmClaim: async (id, ctx = {}) => {
      const res = await confirmClaim(circleStore, id, mkCtx(ctx));
      if (res && !res.error) {
        appendAudit({ itemId: id, action: 'confirmClaim', ctx, details: { assignee: res.confirmedAssignee } });
      }
      return res;
    },
    // Spawn a subtask under `parentId` on the CONTAINMENT model, gated on a CONFIRMED claim (or master/admin).
    // Returns `{queued:true,...}` past the approval depth (the caller files the request), else `{task, depth}`.
    spawnSubtask: async (parentId, args = {}, ctx = {}) => {
      const res = await spawnSubtask(circleStore, parentId, args, mkCtx(ctx));
      if (res && !res.queued && res.task) {
        appendAudit({ itemId: res.task.id, action: ctx.actionOverride ?? 'spawnSubtask', ctx, details: { parentId } });
        recordLog(createTaskEvent({ taskId: res.task.id, by: ctx.actor ?? res.task.createdBy, at: Date.now(), item: res.task }));
      }
      return res;
    },
    // Establish a CONTAINMENT edge (parent embed + child `containedBy`) directly — for the already-authorised
    // approve/force-spawn flows that create the child as the ORIGINAL requester (preserving `addedBy`) and then
    // nest it, rather than going through the confirmed-claim `spawnSubtask` gate.
    contain: async (parentId, childId, ctx = {}) => {
      const res = await containImpl(circleStore, parentId, childId);
      appendAudit({ itemId: childId, action: 'contain', ctx, details: { parentId } });
      return res;
    },
    reassign: async (id, newAssignee, ctx = {}) => {
      const res = await reassign(circleStore, id, newAssignee, mkCtx(ctx));
      if (!res?.error) {
        appendAudit({ itemId: id, action: 'reassign', ctx, details: { from: res.claimBase ?? null, to: newAssignee } });
        recordLog(reassignTaskEvent({ taskId: id, by: ctx.actor, at: Date.now(), to: newAssignee }));
      }
      return res;
    },
    markComplete: async (refs, ctx = {}) => {
      const completed = await markComplete(circleStore, refs, mkCtx(ctx));
      for (const item of completed) {
        appendAudit({
          itemId: item.id,
          action: ctx.actionOverride ?? 'complete',
          ctx,
          details: ctx.reason ? { reason: ctx.reason } : undefined,
        });
        recordLog(completeTaskEvent({ taskId: item.id, by: ctx.actor, at: Date.now(), reason: ctx.reason }));
      }
      return completed;
    },
    submit: async (id, args, ctx = {}) => {
      const res = await submit(circleStore, id, args, mkCtx(ctx));
      appendAudit({ itemId: id, action: 'submit', ctx, details: args?.note ? { note: args.note } : undefined });
      recordLog(submitTaskEvent({ taskId: id, by: ctx.actor, at: Date.now(), args }));
      return res;
    },
    approve: async (id, args, ctx = {}) => {
      const res = await approve(circleStore, id, args, mkCtx(ctx));
      if (!res?.error) {
        const details = {
          ...(args?.note ? { note: args.note } : {}),
          ...(ctx.reason ? { reason: ctx.reason } : {}),
        };
        appendAudit({ itemId: id, action: ctx.actionOverride ?? 'approve', ctx, details });
        recordLog(approveTaskEvent({ taskId: id, by: ctx.actor, at: Date.now(), args }));
      }
      return res;
    },
    reject: async (id, args, ctx = {}) => {
      const res = await reject(circleStore, id, args, mkCtx(ctx));
      appendAudit({ itemId: id, action: 'reject', ctx, details: { note: args?.note } });
      recordLog(rejectTaskEvent({ taskId: id, by: ctx.actor, at: Date.now(), args }));
      return res;
    },
    revoke: async (id, args, ctx = {}) => {
      let previousAssignee = null;
      const res = await revoke(circleStore, id, args, mkCtx(ctx, (name, payload) => {
        if (name === 'item-revoked') previousAssignee = payload?.previousAssignee ?? null;
      }));
      appendAudit({ itemId: id, action: 'revoke', ctx, details: { reason: args?.reason, previousAssignee } });
      recordLog(revokeTaskEvent({ taskId: id, by: ctx.actor, at: Date.now(), args }));
      return res;
    },

    // ── Approval-mode transition (ItemStore-only op, re-implemented) ──────────
    setApprovalMode: async (id, mode, ctx = {}) => {
      const actor = requireActor(ctx);
      if (!isApprovalMode(mode)) {
        throw new TypeError(`setApprovalMode: invalid mode ${JSON.stringify(mode)}`);
      }
      const current = await circleStore.get(id);
      if (!current) throw new ItemNotFoundError(id);
      if (current.completedAt) {
        throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'setApprovalMode' });
      }
      gate(rolePolicy, 'canEditBody', actor, current, { approval: mode });
      const res = await circleStore.put({ ...current, approval: mode }, { by: actor });
      appendAudit({ itemId: id, action: 'update', ctx, details: { fields: ['approval'], approval: mode } });
      emitter.emit('item-updated', res);
      return res;
    },

    // ── Audit read ───────────────────────────────────────────────────────────
    auditLog: async (filter) => applyAuditFilter([...audit], filter),

    // ── Inbound sync ingest (gate-bypass; causal put via origin path) ────────
    applySync: async ({ syncedFromId, nextState, action } = {}, ctx = {}) => {
      if (typeof syncedFromId !== 'string' || !syncedFromId) throw new TypeError('applySync: syncedFromId required');
      if (!nextState || typeof nextState !== 'object') throw new TypeError('applySync: nextState required');
      const local = await findBySyncedFromId(syncedFromId);
      if (!local) return null;

      const localSource = local.source ?? {};
      const nextSource  = nextState.source ?? {};
      const merged = {
        ...nextState,
        id:        local.id,
        type:      nextState.type ?? local.type,      // CircleItemStore.put requires `type`
        createdAt: local.createdAt,
        createdBy: local.createdBy,
        // Preserve local audit identity — parity with `ItemStore.applySync`
        // (the compat `addedAt`/`addedBy` + createdAt/By stay the local copy's).
        ...(local.addedAt !== undefined ? { addedAt: local.addedAt } : {}),
        ...(local.addedBy !== undefined ? { addedBy: local.addedBy } : {}),
        ...(local.addedByDisplayName ? { addedByDisplayName: local.addedByDisplayName } : {}),
        source: {
          ...nextSource,
          ...localSource,               // local syncedFromId / synced flags win
          syncedFromId,                 // belt + braces
        },
      };
      // Causal, gate-bypass inbound: preserve the origin clock + drop a causally
      // older inbound; suppress the fan-out so the ingest never echoes back.
      const stored = await circleStore.put(merged, { origin: true, sync: false });
      appendAudit({
        itemId: local.id,
        action: `sync-${action ?? 'update'}`,
        actor: ctx.remoteActor ?? 'substrate',
        actorDisplayName: ctx.remoteActorDisplayName,
        synced: true,
      });
      emitter.emit(syncEventFor(action), stored);
      return stored;
    },
    removeSync: async ({ syncedFromId } = {}, ctx = {}) => {
      if (typeof syncedFromId !== 'string' || !syncedFromId) throw new TypeError('removeSync: syncedFromId required');
      const local = await findBySyncedFromId(syncedFromId);
      if (!local) return null;
      await circleStore.delete(local.id, { sync: false });   // inbound delete: no re-publish
      appendAudit({ itemId: local.id, action: 'sync-remove', actor: ctx.remoteActor ?? 'substrate', synced: true });
      emitter.emit('item-removed', { id: local.id, item: local });
      return local;
    },

    // ── The task-log (the record cutover) ────────────────────────────────────
    // Every verb above ALSO appends a typed entry to `logEntries`; the store row is the
    // materialised head of replaying those. `onLogEntry` is where the peer transport
    // subscribes to fan a transition; `applyLogEntry` is the inbound counterpart — and
    // unlike `applySync`, it REPLAYS the entry through the real verbs, so a `create` for a
    // task this device never saw produces it by construction (the fan-out fix).

    /** Subscribe to outbound transitions (the fan). Returns an unsubscribe handle. */
    onLogEntry: (fn) => {
      if (typeof fn !== 'function') return () => {};
      logSubs.add(fn);
      return () => logSubs.delete(fn);
    },

    /** Read the task-log — most-recently-appended last. A defensive copy. */
    taskLog: () => logEntries.slice(),

    /**
     * Ingest one inbound task-log entry by REPLAYING it through the verbs against a
     * `sync:false` proxy (no echo). Idempotent: a re-delivery of an already-folded entry
     * is skipped. Best-effort: an entry whose target isn't here yet (out-of-order arrival)
     * is left un-folded and un-seen, so a later re-delivery — once its `create` has landed —
     * still applies. Emits the parity event so `Circle.js` listeners fire, exactly as
     * `applySync` does.
     */
    applyLogEntry: async (entry) => {
      if (!entry || entry.kind !== TASK_LOG_KIND || typeof entry.taskId !== 'string') return null;
      const id = taskEntryId(entry);
      if (seenEntryIds.has(id)) return null;   // idempotent re-delivery
      let res;
      try {
        res = await applyTaskEntry(ingestProxy(circleStore), entry);
      } catch {
        return null;   // out-of-order / not-yet-applicable: leave un-seen for a later retry
      }
      logEntries.push(entry);
      seenEntryIds.add(id);
      const payload = Array.isArray(res) ? res[0] : res;
      emitter.emit(taskEventName(entry.event), payload ?? { id: entry.taskId });
      for (const fn of logSubs) { try { fn(entry); } catch { /* re-fan is best-effort */ } }
      return payload ?? null;
    },
  };
}
