/**
 * ItemStore — the public API.
 *
 * ⚠ RETIRED as a production store (2026-07-18, PLAN-capabilities-tasks-roles
 * ). NO application constructs `new ItemStore` anymore — every consumer
 * (tasks-v0, stoop, tasks-mobile, household, presence-v0) runs on the canonical
 * thin `CircleItemStore` + the lifecycle/CRUD FUNCTIONS over it (`taskLifecycle`
 * / `taskCrud`), bundled for the ItemStore-ergonomic surface by `createTaskStore`.
 * This class is retained ONLY as (a) the parity reference the migration tests
 * assert against, (b) the export of the pure `computeStatus` (still imported by
 * `taskLifecycle`). Do NOT use it in new code. Final cleanup (extract
 * `computeStatus` to its own module; delete the class + its h2/h4 tests once the
 * parity tests are self-standing) is a tracked follow-up.
 *
 * **Migrated 2026-05-04 (Phase 5.2 of substrate refactor).**  The
 * pre-2026-05-04 version had a custom `Backend` interface (whose only
 * implementation was the synthetic `InMemoryBackend`) that duplicated
 * `core.DataSource`. Per the L1b audit, the substrate now composes a
 * `core.DataSource` directly — `MemorySource` for tests, an adapter
 * over `pod-client.PodClient` for production. No reinvented Backend.
 *
 * Storage layout (under `rootContainer`):
 *   - `items/<id>.json`   — the item state (open or closed; check
 *                           `completedAt` to disambiguate).
 *   - `audit/<entry-id>.json` — one audit entry per file. Listing
 *                           `audit/` returns all entries.
 *
 * Per-field merge contracts (unchanged conceptually):
 *  - Body fields (text, notes, dependencies, requiredSkills, dueAt,
 *    visibility) — LWW.
 *  - assignee — compare-and-swap (claim race resolution) via
 *    `_etag` round-trip in the substrate; for true distributed atomicity,
 *    pair with a `pod-client.PodClient`-backed DataSource that honours
 *    `ifMatch` / `If-None-Match` at the HTTP layer.
 *  - completedAt + completedBy — LWW; role-policy gates duplicate completes.
 *  - audit log — append-only (one file per entry; never edited).
 */

import { Emitter, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import { computeStatus } from './lifecycleStatus.js';   // pure status fn, extracted out of this retired class

import { ulid }                        from './ulid.js';
import { audienceFromItem, audienceMatches, audienceMatchesAny } from './audience.js';
import {
  ItemNotFoundError,
  PermissionDeniedError,
  InvalidLifecycleError,
  MissingArgumentError,
  DependenciesOpenError,
} from './errors.js';

const NOOP_POLICY = Object.freeze({});

// Parameter register (#36) — id / id-prefix resolution bounds (scope:device, kind:internal).
const ID_PREFIX_LEN = param({ key: 'itemStore.idPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });
const MIN_PREFIX_LEN = param({ key: 'itemStore.minPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });

const ITEMS_DIR = 'items';
const AUDIT_DIR = 'audit';

/**
 * Item/task store over an injected `core.DataSource`, persisting item state under
 * `<rootContainer>/items/` and an append-only audit log under `<rootContainer>/audit/`. Offers
 * CRUD (`addItems` / `update` / `removeItems` / `getById` / `listOpen` / `listClosed`), lifecycle
 * verbs (`claim` / `reassign` / `markComplete` / `submit` / `approve` / `reject` / `revoke`) gated
 * by the injected role policy, and cross-store sync ingestion (`applySync` / `removeSync`).
 * Extends core `Emitter` and emits per-action item events. See the module doc for the per-field
 * merge contracts.
 */
export class ItemStore extends Emitter {
  /** @type {import('@onderling/core').DataSource} */
  #source;

  /** @type {string} root URI prefix (always ends in '/') */
  #root;

  /** @type {import('./types.js').RolePolicy} */
  #policy;

  /** @type {boolean} — gate close-transitions on open dependencies. */
  #enforceDependencies;

  /**
   * @param {object} args
   * @param {import('@onderling/core').DataSource} args.dataSource
   *   Any `core.DataSource` subclass. `MemorySource` for tests; an
   *   adapter over `pod-client.PodClient` for Solid-pod production.
   * @param {string} args.rootContainer
   *   URI / path prefix under which `items/` and `audit/` live.
   *   Trailing '/' is normalised.
   * @param {import('./types.js').RolePolicy} [args.rolePolicy]
   *   Optional gate; default is no-op (everything allowed).
   * @param {boolean} [args.enforceDependencies=false]
   *   when `true`, `markComplete` and `approve` reject with
   *   `DependenciesOpenError` if `item.dependencies[]` contains any
   *   open (uncompleted, present) entries. Removed-or-missing deps
   *   are treated as satisfied. Off by default for back-compat;
   *   apps with DAG semantics opt in (Tasks does, Stoop doesn't).
   *   The gate is bypassed when `ctx.actionOverride` is supplied
   *   (force-complete admin path).
   */
  constructor({ dataSource, rootContainer, rolePolicy, enforceDependencies = false }) {
    super();
    if (!dataSource || typeof dataSource.read !== 'function') {
      throw new Error('ItemStore: dataSource (core.DataSource) required');
    }
    if (typeof rootContainer !== 'string' || !rootContainer) {
      throw new Error('ItemStore: rootContainer required');
    }
    this.#source = dataSource;
    this.#root   = rootContainer.endsWith('/') ? rootContainer : rootContainer + '/';
    this.#policy = rolePolicy ?? NOOP_POLICY;
    this.#enforceDependencies = !!enforceDependencies;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Add one or more items.  Substrate generates ids + addedAt.
   * @param {Array<Partial<import('./types.js').Item>>} items
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item[]>}
   * @fires ItemStore#item-added
   */
  async addItems(items, ctx) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const actor = this.#requireActor(ctx);
    const persisted = [];
    for (const partial of items) {
      this.#validatePartial(partial);
      const item = this.#materialise(partial, ctx);
      this.#gate('canAdd', actor, item);
      await this.#writeItem(item);
      await this.#appendAudit({
        id: ulid(), itemId: item.id,
        action: ctx.actionOverride ?? 'add',
        actor, actorDisplayName: ctx.actorDisplayName,
        at: item.addedAt,
        ...(ctx.reason ? { details: { reason: ctx.reason } } : {}),
      });
      persisted.push(item);
      this.emit('item-added', item);
    }
    return persisted;
  }

  /**
   * List open items matching the filter.  "Open" = `completedAt` absent.
   * @param {import('./types.js').ListFilter} [filter]
   * @returns {Promise<import('./types.js').Item[]>}
   */
  async listOpen(filter) {
    const items = await this.#listAllItems();
    return this.#filterItems(items.filter((i) => !i.completedAt), filter);
  }

  /**
   * List closed items matching the filter.
   * @param {import('./types.js').ListFilter} [filter]
   * @returns {Promise<import('./types.js').Item[]>}
   */
  async listClosed(filter) {
    const items = await this.#listAllItems();
    return this.#filterItems(items.filter((i) => i.completedAt !== undefined && i.completedAt !== null), filter);
  }

  /**
   * Read a single item by id.
   * @param {string} id
   * @returns {Promise<import('./types.js').Item|null>}
   */
  async getById(id) {
    return this.#readItem(id);
  }

  /**
   * Mark items complete.
   * @param {Array<import('./types.js').ItemRef>} refs
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item[]>}
   * @fires ItemStore#item-completed
   */
  async markComplete(refs, ctx) {
    if (!Array.isArray(refs) || refs.length === 0) return [];
    const actor = this.#requireActor(ctx);
    const completed = [];
    for (const ref of refs) {
      const isExplicit = typeof ref?.id === 'string';
      const item = isExplicit
        ? await this.#readItem(ref.id)
        : await this.#resolveRef(ref);
      if (!item) {
        if (isExplicit) throw new ItemNotFoundError(ref.id);
        continue;
      }
      if (item.completedAt) {
        if (isExplicit) {
          throw new InvalidLifecycleError({
            itemId: item.id, currentState: 'completed', attemptedAction: 'complete',
          });
        }
        continue;
      }
      this.#gate('canComplete', actor, item);
      // enforce dependencies unless caller supplied an
      // explicit `actionOverride` (force-complete admin path).
      if (this.#enforceDependencies && !ctx.actionOverride) {
        await this._assertDepsClosed(item);
      }
      const at = Date.now();
      const updated = {
        ...item,
        completedAt: at,
        completedBy: actor,
        ...(ctx.actorDisplayName ? { completedByDisplayName: ctx.actorDisplayName } : {}),
        _etag: ulid(),
      };
      await this.#writeItem(updated);
      await this.#appendAudit({
        id: ulid(), itemId: item.id,
        action: ctx.actionOverride ?? 'complete',
        actor, actorDisplayName: ctx.actorDisplayName, at,
        ...(ctx.reason ? { details: { reason: ctx.reason } } : {}),
      });
      completed.push(updated);
      this.emit('item-completed', updated);
    }
    return completed;
  }

  /**
   * Apply a sync from a peer — substrate-internal mutation.
   *
   * Phase 52.9.3 (2026-05-14). The substrate-mirror calls
   * this when an inbound `kind: 'task'` envelope describes a state
   * change for an item we already have locally (matched by
   * `source.syncedFromId`). Unlike the public mutation methods
   * (`claim`, `markComplete`, `reassign`, etc.), this path:
   *   - Bypasses the role-policy gate. The sender already validated
   *     authorization on their side; the substrate is trusted.
   *   - Preserves the local item's `id`, `addedAt`, and audit chain.
   *   - Updates everything else from `nextState`.
   *   - Audits with `action: 'sync-<actionTag>'`, `synced: true`.
   *   - Emits the matching standard event (`item-claimed`,
   *     `item-completed`, etc.) so existing UI listeners react.
   *
   * Returns the merged local item, or `null` when no local item
   * with the supplied `syncedFromId` exists (the caller can then
   * fall back to `addItems` for a fresh local copy).
   *
   * @param {{ syncedFromId: string, nextState: object, action?: string }} args
   * @param {{ remoteActor?: string, remoteActorDisplayName?: string }} ctx
   * @returns {Promise<import('./types.js').Item|null>}
   */
  async applySync({ syncedFromId, nextState, action }, ctx = {}) {
    if (typeof syncedFromId !== 'string' || !syncedFromId) {
      throw new TypeError('applySync: syncedFromId required');
    }
    if (!nextState || typeof nextState !== 'object') {
      throw new TypeError('applySync: nextState required');
    }
    const local = await this.#findBySyncedFromId(syncedFromId);
    if (!local) return null;

    // Merge: preserve local id / addedAt / audit identity; overwrite
    // mutable state. The local `source.syncedFromId` marker stays so
    // future syncs continue to find the item.
    const localSource = local.source ?? {};
    const nextSource  = nextState.source ?? {};
    const merged = {
      ...nextState,
      id:           local.id,
      addedAt:      local.addedAt,
      addedBy:      local.addedBy,
      ...(local.addedByDisplayName ? { addedByDisplayName: local.addedByDisplayName } : {}),
      source: {
        ...nextSource,
        ...localSource,                  // local syncedFromId / synced flags win
        syncedFromId,                    // belt + braces
      },
      _etag: ulid(),
    };

    await this.#writeItem(merged);
    await this.#appendAudit({
      id: ulid(),
      itemId: local.id,
      action: `sync-${action ?? 'update'}`,
      actor:  ctx.remoteActor ?? 'substrate',
      actorDisplayName: ctx.remoteActorDisplayName,
      at: Date.now(),
      synced: true,
    });

    const eventName =
      action === 'claim'    ? 'item-claimed'   :
      action === 'complete' ? 'item-completed' :
      action === 'submit'   ? 'item-submitted' :
      action === 'approve'  ? 'item-approved'  :
      action === 'reject'   ? 'item-rejected'  :
      action === 'revoke'   ? 'item-revoked'   :
      action === 'reassign' ? 'item-reassigned' :
      'item-updated';
    this.emit(eventName, merged);
    return merged;
  }

  /**
   * Hard-delete a synced item by its peer-side id. Mirror of
   * `applySync` for the removal case. Returns the deleted item, or
   * `null` when no match.
   *
   * Phase 52.9.3 (2026-05-14).
   */
  async removeSync({ syncedFromId }, ctx = {}) {
    if (typeof syncedFromId !== 'string' || !syncedFromId) {
      throw new TypeError('removeSync: syncedFromId required');
    }
    const local = await this.#findBySyncedFromId(syncedFromId);
    if (!local) return null;
    await this.#deleteItem(local.id);
    await this.#appendAudit({
      id: ulid(), itemId: local.id, action: 'sync-remove',
      actor: ctx.remoteActor ?? 'substrate',
      at: Date.now(),
      synced: true,
    });
    this.emit('item-removed', { id: local.id, item: local });
    return local;
  }

  /**
   * Hard-delete items.
   * @param {Array<import('./types.js').ItemRef>} refs
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<string[]>}
   * @fires ItemStore#item-removed
   */
  async removeItems(refs, ctx) {
    if (!Array.isArray(refs) || refs.length === 0) return [];
    const actor = this.#requireActor(ctx);
    const removed = [];
    for (const ref of refs) {
      const item = await this.#resolveRef(ref);
      if (!item) continue;
      this.#gate('canRemove', actor, item);
      await this.#deleteItem(item.id);
      await this.#appendAudit({
        id: ulid(), itemId: item.id, action: 'remove',
        actor, actorDisplayName: ctx.actorDisplayName,
        at: Date.now(),
      });
      removed.push(item.id);
      this.emit('item-removed', { id: item.id, item });
    }
    return removed;
  }

  /**
   * Compare-and-swap claim. Loser gets `{error:'already-claimed', current}`.
   * @param {string} id
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item | {error: 'already-claimed', current: import('./types.js').Item}>}
   * @fires ItemStore#item-claimed on success
   */
  async claim(id, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'claim',
      });
    }
    if (current.assignee) {
      return { error: 'already-claimed', current };
    }
    this.#gate('canClaim', actor, current);
    const at = Date.now();
    // CAS via read-check-write. For true distributed atomicity, pair the
    // store with a pod-client.PodClient-backed DataSource that honours
    // ifMatch at the HTTP layer.
    const updated = {
      ...current,
      assignee: actor,
      claimedAt: at,
      _etag: ulid(),
    };
    // (task-claim-partition) — central-pod one-winner. When the
    // DataSource advertises conditional writes (`readEtag` ⇒ pod-backed
    // etag-CAS), claim as a compare-and-swap against the base etag: a
    // racing second writer gets a `CONFLICT` (HTTP 409/412) which maps to
    // the existing `{error:'already-claimed', current}` contract (re-read
    // to surface the winner). Non-CAS DataSources (MemorySource, …) keep
    // the read-check-write path byte-for-byte unchanged.
    const conflict = await this.#casWriteOrConflict(id, updated, current);
    if (conflict) return conflict;
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'claim',
      actor, actorDisplayName: ctx.actorDisplayName, at,
    });
    this.emit('item-claimed', updated);
    return updated;
  }

  /**
   * (task-claim-partition) — conditional-write helper for `claim`.
   *
   * When the DataSource is CAS-capable (duck-typed via `readEtag`), write
   * `updated` with an `If-Match` precondition against the current base
   * etag. A precondition failure (`code:'CONFLICT'` / HTTP 409 / 412) means
   * another writer claimed first → returns `{error:'already-claimed',
   * current}` after re-reading the winner. Any other error propagates.
   *
   * When the DataSource is NOT CAS-capable, this is exactly the previous
   * `await this.#writeItem(updated)` — no behaviour change.
   *
   * @returns {Promise<null | {error:'already-claimed', current: object}>}
   *   `null` on success (caller proceeds to audit + emit).
   */
  async #casWriteOrConflict(id, updated, current) {
    const src = this.#source;
    if (typeof src.readEtag !== 'function') {
      await this.#writeItem(updated);
      return null;
    }
    let baseEtag = null;
    try { baseEtag = await src.readEtag(this.#itemUri(id)); }
    catch { baseEtag = null; }
    try {
      await this.#writeItem(updated, baseEtag != null ? { ifMatch: baseEtag } : undefined);
      return null;
    } catch (err) {
      const conflict = err && (err.code === 'CONFLICT' || err.status === 409 || err.status === 412);
      if (conflict) {
        const fresh = await this.#readItem(id);
        return { error: 'already-claimed', current: fresh ?? current };
      }
      throw err;
    }
  }

  /**
   * Reassign — role-policy-gated.
   * @param {string} id
   * @param {string|null} newAssignee
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-claimed (on reassign to a webid)
   * @fires ItemStore#item-updated (on release to null)
   */
  async reassign(id, newAssignee, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'reassign',
      });
    }
    this.#gate('canReassign', actor, current);
    const at = Date.now();
    const updated = {
      ...current,
      assignee: newAssignee ?? undefined,
      claimedAt: newAssignee ? at : undefined,
      // (task-claim-partition) — causal-base marker. A reassign
      // KNOWS the assignment it supersedes, so it records the prior
      // assignee. The substrate mirror uses this to tell a *causal*
      // reassign (`claimBase === the peer's current assignee`) from a
      // *concurrent* double-claim (differing claimants, no shared base) —
      // only the latter is routed to a claim-conflict. A fresh `claim`
      // carries no `claimBase` (it branches from the unassigned task).
      claimBase: current.assignee ?? null,
      _etag: ulid(),
    };
    if (!newAssignee) delete updated.assignee;
    if (!newAssignee) delete updated.claimedAt;
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'reassign',
      actor, actorDisplayName: ctx.actorDisplayName, at,
      details: { from: current.assignee ?? null, to: newAssignee },
    });
    if (newAssignee) {
      this.emit('item-claimed', updated);
    } else {
      this.emit('item-updated', updated);
    }
    return updated;
  }

  /**
   * Edit body fields (LWW). Forbids attribution / completion / assignment edits.
   * @param {string} id
   * @param {Partial<import('./types.js').Item>} patch
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-updated
   */
  async update(id, patch, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    this.#assertEditableFields(patch);
    this.#gate('canEditBody', actor, current, patch);
    const updated = {
      ...current,
      ...patch,
      _etag: ulid(),
    };
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'update',
      actor, actorDisplayName: ctx.actorDisplayName, at: Date.now(),
      details: { fields: Object.keys(patch) },
    });
    this.emit('item-updated', updated);
    return updated;
  }

  /**
   * Read the audit log.  Filterable by item / actor / action / time.
   * @param {import('./types.js').AuditFilter} [filter]
   * @returns {Promise<import('./types.js').AuditEntry[]>}
   */
  async auditLog(filter) {
    return this.#listAudit(filter);
  }

  // ── DoD lifecycle (Tasks V1) ───────────────────────────────────────────────

  /**
   * Submit a claimed item for approval. The assignee marks it
   * "klaar wat mij betreft"; the deliverable (optional) carries the
   * artifact reference. State goes `claimed → submitted`.
   *
   * Idempotent on `submitted` only when the same actor re-submits
   * an updated deliverable; the second submission overwrites the
   * deliverable + appends another `'submit'` reviewLog entry.
   *
   * @param {string} id
   * @param {{deliverable?: import('./types.js').Deliverable, note?: string}} args
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-submitted
   */
  async submit(id, args, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'submit',
      });
    }
    const status = computeStatus(current);
    // Allow:
    //   - claimed   (first-time submission)
    //   - submitted (re-submit with an updated deliverable)
    //   - rejected  (assignee re-works after approver pushed back)
    if (status !== 'claimed' && status !== 'submitted' && status !== 'rejected') {
      throw new InvalidLifecycleError({
        itemId: id, currentState: status, attemptedAction: 'submit',
      });
    }
    this.#gate('canSubmit', actor, current);

    const at = Date.now();
    const reviewLog = _appendReview(current.reviewLog, {
      at, by: actor, decision: 'submit', note: args?.note,
    });
    const deliverable = args?.deliverable
      ? { ...args.deliverable, submittedAt: at }
      : current.deliverable;

    const updated = {
      ...current,
      reviewLog,
      ...(deliverable ? { deliverable } : {}),
      _etag: ulid(),
    };
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'submit',
      actor, actorDisplayName: ctx.actorDisplayName, at,
      details: args?.note ? { note: args.note } : undefined,
    });
    this.emit('item-submitted', updated);
    return updated;
  }

  /**
   * Approve a submitted item. The approver designated by
   * `item.approval` (or `master` / `addedBy` for `'creator'` mode)
   * signs off. State goes `submitted → complete` and dependents
   * become `ready`.
   *
   * For `approval: 'self-mark'` items this method is rarely called
   * — apps use `markComplete` directly. It still works (treats the
   * item as already-approved-by-its-assignee).
   *
   * @param {string} id
   * @param {{note?: string}} args
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-completed
   */
  async approve(id, args, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'approve',
      });
    }
    const status = computeStatus(current);
    if (status !== 'submitted') {
      throw new InvalidLifecycleError({
        itemId: id, currentState: status, attemptedAction: 'approve',
      });
    }
    this.#gate('canApprove', actor, current);
    // enforce dependencies on the approve close-transition too.
    if (this.#enforceDependencies && !ctx.actionOverride) {
      await this._assertDepsClosed(current);
    }

    const at = Date.now();
    const reviewLog = _appendReview(current.reviewLog, {
      at, by: actor, decision: 'approve', note: args?.note,
    });
    const updated = {
      ...current,
      reviewLog,
      completedAt: at,
      completedBy: actor,
      ...(ctx.actorDisplayName ? { completedByDisplayName: ctx.actorDisplayName } : {}),
      _etag: ulid(),
    };
    await this.#writeItem(updated);
    const auditDetails = {
      ...(args?.note ? { note: args.note } : {}),
      ...(ctx.reason ? { reason: ctx.reason } : {}),
    };
    await this.#appendAudit({
      id: ulid(), itemId: id,
      action: ctx.actionOverride ?? 'approve',
      actor, actorDisplayName: ctx.actorDisplayName, at,
      ...(Object.keys(auditDetails).length > 0 ? { details: auditDetails } : {}),
    });
    this.emit('item-completed', updated);
    return updated;
  }

  /**
   * Reject a submitted item with a mandatory note. State goes
   * `submitted → rejected` (which `computeStatus` reports
   * distinctly from `claimed`); the assignee can re-work and
   * `submit` again.
   *
   * @param {string} id
   * @param {{note: string}} args
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-rejected
   */
  async reject(id, args, ctx) {
    const actor = this.#requireActor(ctx);
    if (!args?.note || typeof args.note !== 'string' || !args.note.trim()) {
      throw new MissingArgumentError({ itemId: id, action: 'reject', argument: 'note' });
    }
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'reject',
      });
    }
    const status = computeStatus(current);
    if (status !== 'submitted') {
      throw new InvalidLifecycleError({
        itemId: id, currentState: status, attemptedAction: 'reject',
      });
    }
    this.#gate('canReject', actor, current);

    const at = Date.now();
    const reviewLog = _appendReview(current.reviewLog, {
      at, by: actor, decision: 'reject', note: args.note,
    });
    const updated = {
      ...current,
      reviewLog,
      _etag: ulid(),
    };
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'reject',
      actor, actorDisplayName: ctx.actorDisplayName, at,
      details: { note: args.note },
    });
    this.emit('item-rejected', updated);
    return updated;
  }

  /**
   * Revoke the assignee. Master-only; reason is mandatory. State
   * goes `claimed → open`. The previous assignee's webid is recorded
   * in the reviewLog so they can `appeal` (an app-level chat-thread
   * skill) if surprised.
   *
   * `master` is preserved across the revoke.
   *
   * @param {string} id
   * @param {{reason: string}} args
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-revoked
   */
  async revoke(id, args, ctx) {
    const actor = this.#requireActor(ctx);
    if (!args?.reason || typeof args.reason !== 'string' || !args.reason.trim()) {
      throw new MissingArgumentError({ itemId: id, action: 'revoke', argument: 'reason' });
    }
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'revoke',
      });
    }
    if (!current.assignee) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'open', attemptedAction: 'revoke',
      });
    }
    this.#gate('canRevoke', actor, current);

    const at = Date.now();
    const previousAssignee = current.assignee;
    const reviewLog = _appendReview(current.reviewLog, {
      at, by: actor, decision: 'revoke', note: args.reason,
    });
    const updated = {
      ...current,
      reviewLog,
      _etag: ulid(),
    };
    delete updated.assignee;
    delete updated.claimedAt;
    // Submitted state is implicitly cleared because computeStatus reads
    // from reviewLog tail — but a 'revoke' AFTER 'submit' should leave
    // the item in `open`, not `submitted`. The reviewLog tail is now
    // 'revoke', so computeStatus returns 'open' as expected.
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'revoke',
      actor, actorDisplayName: ctx.actorDisplayName, at,
      details: { reason: args.reason, previousAssignee },
    });
    this.emit('item-revoked', { item: updated, previousAssignee, reason: args.reason });
    return updated;
  }

  /**
   * Set or change the approval mode of an existing item. App-level
   * role-policy gates this (admin / coordinator / addedBy only by
   * convention). Substrate just enforces value-shape.
   *
   * @param {string} id
   * @param {import('./types.js').ApprovalMode} mode
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   */
  async setApprovalMode(id, mode, ctx) {
    const actor = this.#requireActor(ctx);
    if (!_isApprovalMode(mode)) {
      throw new TypeError(`setApprovalMode: invalid mode ${JSON.stringify(mode)}`);
    }
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'setApprovalMode',
      });
    }
    // Reuse canEditBody for the gate — apps that want a stricter
    // gate on approval-mode flips can subclass / wrap.
    this.#gate('canEditBody', actor, current, { approval: mode });
    const updated = { ...current, approval: mode, _etag: ulid() };
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'update',
      actor, actorDisplayName: ctx.actorDisplayName, at: Date.now(),
      details: { fields: ['approval'], approval: mode },
    });
    this.emit('item-updated', updated);
    return updated;
  }

  // ── Storage helpers (DataSource-backed) ─────────────────────────────────

  #itemUri(id)  { return `${this.#root}${ITEMS_DIR}/${id}.json`; }
  #auditUri(id) { return `${this.#root}${AUDIT_DIR}/${id}.json`; }

  async #writeItem(item, opts) {
    // `opts` carries an optional `{ifMatch}` precondition for
    // CAS-capable DataSources. MemorySource & friends ignore the extra
    // arg, so the default (non-CAS) write path is unchanged.
    await this.#source.write(this.#itemUri(item.id), JSON.stringify(item), opts);
  }

  async #readItem(id) {
    const raw = await this.#source.read(this.#itemUri(id));
    if (raw === null || raw === undefined) return null;
    return parseItem(raw);
  }

  async #deleteItem(id) {
    await this.#source.delete(this.#itemUri(id));
  }

  async #listAllItems() {
    const prefix = `${this.#root}${ITEMS_DIR}/`;
    const keys = await this.#source.list(prefix);
    const out = [];
    for (const key of keys) {
      const raw = await this.#source.read(key);
      if (raw === null || raw === undefined) continue;
      const parsed = parseItem(raw);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async #appendAudit(entry) {
    await this.#source.write(this.#auditUri(entry.id), JSON.stringify(entry));
  }

  async #listAudit(filter) {
    const prefix = `${this.#root}${AUDIT_DIR}/`;
    const keys = await this.#source.list(prefix);
    const entries = [];
    for (const key of keys) {
      const raw = await this.#source.read(key);
      if (raw === null || raw === undefined) continue;
      const parsed = parseItem(raw);
      if (parsed) entries.push(parsed);
    }
    return applyAuditFilter(entries, filter);
  }

  // ── Filtering ───────────────────────────────────────────────────────────

  #filterItems(items, filter) {
    if (!filter) return [...items];
    let out = items;
    if (typeof filter.type === 'string') {
      out = out.filter((i) => i.type === filter.type);
    }
    if (typeof filter.requiredSkill === 'string') {
      const want = filter.requiredSkill;
      out = out.filter((i) => Array.isArray(i.requiredSkills) && i.requiredSkills.includes(want));
    }
    if ('assignee' in filter) {
      if (filter.assignee === null) {
        out = out.filter((i) => !i.assignee);
      } else if (typeof filter.assignee === 'string') {
        out = out.filter((i) => i.assignee === filter.assignee);
      }
    }
    // match against an item's effective audience (via the
    // audienceFromItem bridge, so legacy `visibility`-only items still
    // resolve).  `audienceMatches` implements: exact structural
    // equality (the original V0b behaviour) PLUS membership for
    // container audiences — a `union` item matches when the queried
    // audience is one of its constituents; a `set` item matches when
    // the queried plain-string webid is a member.  See
    // `audience.js#audienceMatches` for the full semantics.
    //
    // Still NOT normalised: `'circle:X'` (short-hand) and
    // `{kind:'circle-ref', id:'X'}` (structured) are not equivalent —
    // normalisation lives in `@onderling/circles` (layering).
    if (filter.audience !== undefined) {
      out = out.filter((i) => audienceMatches(audienceFromItem(i), filter.audience));
    }
    // cross-circle query: `filter.audiences` is an audience SET.
    // An item matches when its effective audience satisfies ANY member
    // of the set (see `audience.js#audienceMatchesAny`).  This is how a
    // single query spans multiple circles.  `audience` (single) and
    // `audiences` (set) are independent clauses — both apply (AND) when
    // both are present; the single-audience path is unchanged.  An
    // empty `audiences: []` matches nothing.
    if (filter.audiences !== undefined) {
      out = out.filter((i) => audienceMatchesAny(audienceFromItem(i), filter.audiences));
    }
    return out;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  #materialise(partial, ctx) {
    // DoD-lifecycle defaults (Tasks V1):
    //   - approval defaults to 'self-mark' (same as V0).
    //   - master defaults to addedBy on top-level adds; an explicit
    //     `master` in the partial wins (sub-tasks pre-set the spawner).
    //   - parentTaskId is preserved when supplied.
    const id = ulid();
    return {
      id,
      type:                 partial.type,
      // Phase 52.7.2 (2026-05-14): preserve `kind` if supplied —
      // canonical @onderling/item-types schemas (offer / request /
      // claim, etc.) carry the verb direction (`lend` / `borrow` /
      // `share` / `give` / `receive` / `sell` / `buy` / `help` /
      // `other`) on this field. Apps adopting the canonical shape
      // (Stoop, Tasks) rely on it being persisted alongside `type`.
      ...(partial.kind !== undefined ? { kind: partial.kind } : {}),
      text:                 partial.text,
      ...(partial.notes ? { notes: partial.notes } : {}),
      addedBy:              ctx.actor,
      ...(ctx.actorDisplayName ? { addedByDisplayName: ctx.actorDisplayName } : {}),
      addedAt:              Date.now(),
      ...(partial.dependencies ? { dependencies: [...partial.dependencies] } : {}),
      ...(partial.requiredSkills ? { requiredSkills: [...partial.requiredSkills] } : {}),
      ...(partial.dueAt !== undefined ? { dueAt: partial.dueAt } : {}),
      ...(partial.visibility ? { visibility: partial.visibility } : {}),
      // V0a (2026-05-21) — store the richer `audience` field
      // verbatim when supplied.  Forward-additive; items without it
      // fall back to `visibility` via `audienceFromItem(item)`.
      ...(partial.audience !== undefined ? { audience: partial.audience } : {}),
      ...(partial.source ? { source: partial.source } : {}),
      // DoD-lifecycle additions (all optional, all backward-compatible):
      ...(partial.definitionOfDone ? { definitionOfDone: partial.definitionOfDone } : {}),
      ...(partial.approval ? { approval: partial.approval } : {}),
      ...(partial.parentTaskId ? { parentTaskId: partial.parentTaskId } : {}),
      // V2 — auto-scheduling slot + estimate. Both optional. Substrate
      // doesn't interpret them; consumer apps (Tasks V2) read them
      // for calendar emission, planner, and invoicing rollups.
      ...(partial.scheduledAt     !== undefined ? { scheduledAt:     partial.scheduledAt }     : {}),
      ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
      // Standardisation adoption (2026-05-14, V2 §4b) — cross-pod
      // refs. Propagated through verbatim; canonical @onderling/item-
      // types schemas already declare the field on every type via
      // BASE_PROPERTIES → EMBEDS_SCHEMA.
      ...(Array.isArray(partial.embeds) && partial.embeds.length > 0
        ? { embeds: partial.embeds.map(e => ({ type: e.type, ref: e.ref })) }
        : {}),
      master: partial.master ?? ctx.actor,
      _etag: ulid(),
    };
  }

  #validatePartial(partial) {
    if (!partial || typeof partial !== 'object') {
      throw new TypeError('addItems: each item must be an object');
    }
    if (typeof partial.type !== 'string' || partial.type.length === 0) {
      throw new TypeError('addItems: each item requires a non-empty `type`');
    }
    if (typeof partial.text !== 'string' || partial.text.trim().length === 0) {
      throw new TypeError('addItems: each item requires a non-empty `text`');
    }
  }

  #requireActor(ctx) {
    if (!ctx || typeof ctx.actor !== 'string' || ctx.actor.length === 0) {
      throw new TypeError('ActorContext.actor (webid) is required');
    }
    return ctx.actor;
  }

  /**
   * walk `item.dependencies[]`, look each up, and throw
   * `DependenciesOpenError` if any are open (uncompleted).
   * Removed-or-missing entries are treated as satisfied (don't
   * block forever).
   */
  async _assertDepsClosed(item) {
    const deps = Array.isArray(item?.dependencies) ? item.dependencies : [];
    if (deps.length === 0) return;
    const open = [];
    for (const depId of deps) {
      if (typeof depId !== 'string' || !depId) continue;
      const dep = await this.#readItem(depId);
      if (!dep) continue;                            // missing → treat as satisfied
      if (!dep.completedAt) open.push(depId);
    }
    if (open.length > 0) {
      throw new DependenciesOpenError({ itemId: item.id, openDeps: open });
    }
  }

  #gate(method, actor, item, patch) {
    const fn = this.#policy[method];
    if (typeof fn !== 'function') return;
    const allowed = fn(actor, item, patch);
    if (!allowed) {
      throw new PermissionDeniedError({
        action: method.replace(/^can/, '').toLowerCase(),
        actor,
        itemId: item?.id,
      });
    }
  }

  #assertEditableFields(patch) {
    const forbidden = [
      'id', 'addedBy', 'addedByDisplayName', 'addedAt',
      'completedAt', 'completedBy', 'completedByDisplayName',
      'assignee', 'claimedAt', 'claimBase',
      // DoD-lifecycle fields with their own dedicated transitions:
      'reviewLog',      // append-only via submit/approve/reject/revoke
      'deliverable',    // set via submit
      'approval',       // change via setApprovalMode
      'master',         // (V1: not user-editable; admin override is a future op)
      'parentTaskId',   // immutable after add
    ];
    for (const f of forbidden) {
      if (f in patch) {
        throw new TypeError(
          `update: field '${f}' is not editable through update(); use the dedicated primitive.`,
        );
      }
    }
  }

  async #resolveRef(ref) {
    if (ref && typeof ref.id === 'string') {
      const item = await this.#readItem(ref.id);
      if (item && !item.completedAt) return item;
      return null;
    }
    if (ref && typeof ref.match === 'string' && ref.match.trim().length > 0) {
      const all = await this.#listAllItems();
      const open = all.filter((i) => !i.completedAt);
      return resolveFuzzy(open, ref.match);
    }
    return null;
  }

  /**
   * Lookup helper for Phase 52.9.3 — find the local item
   * whose `source.syncedFromId` matches the supplied peer-side id.
   * Returns `null` on miss. O(N) scan; acceptable for V0 — replace
   * with an index when item-store sizes start to matter.
   */
  async #findBySyncedFromId(syncedFromId) {
    const all = await this.#listAllItems();
    return all.find((i) => i?.source?.syncedFromId === syncedFromId) ?? null;
  }
}

// ── Module-private helpers ────────────────────────────────────────────────

function parseItem(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  // MemorySource may return non-string values directly; pass through.
  if (typeof raw === 'object') return raw;
  return null;
}

function applyAuditFilter(entries, filter) {
  if (!filter) return entries;
  let out = entries;
  if (filter.itemId) out = out.filter((e) => e.itemId === filter.itemId);
  if (filter.actor)  out = out.filter((e) => e.actor  === filter.actor);
  if (filter.action) out = out.filter((e) => e.action === filter.action);
  if (typeof filter.since === 'number') out = out.filter((e) => e.at >= filter.since);
  if (typeof filter.until === 'number') out = out.filter((e) => e.at <= filter.until);
  // Stable order by `at` then `id`.
  return out.sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : 1));
}

function resolveFuzzy(items, match) {
  const m = match.trim();
  const exact = items.find((i) => i.id === m);
  if (exact) return exact;
  if (m.length >= MIN_PREFIX_LEN) {
    const upper = m.toUpperCase();
    const prefixHit = items.find((i) => i.id.startsWith(upper));
    if (prefixHit) return prefixHit;
  }
  const lower = m.toLowerCase();
  const textHit = items.find((i) => i.text.toLowerCase().includes(lower));
  return textHit ?? null;
}

// ── DoD-lifecycle helpers (Tasks V1) ────────────────────────────────────────
// NOTE: the pure `computeStatus` (and its `_lastReviewDecision` helper) now
// live in `./lifecycleStatus.js` and are imported at the top of this file, so
// production consumers no longer route through this retired class.

/** Append-only `reviewLog` writer. Returns a NEW array. */
function _appendReview(prev, entry) {
  const arr = Array.isArray(prev) ? [...prev] : [];
  arr.push(entry);
  return arr;
}

/** Validate ApprovalMode shape. */
function _isApprovalMode(m) {
  if (typeof m !== 'string') return false;
  if (m === 'self-mark' || m === 'creator') return true;
  return m.startsWith('webid:') && m.length > 'webid:'.length;
}

// Re-export the pure status fn so the parity tests (and any legacy consumer)
// can still `import { computeStatus } from './ItemStore.js'`; the source of
// truth is `./lifecycleStatus.js`.
export { computeStatus };
export { ID_PREFIX_LEN, MIN_PREFIX_LEN };
