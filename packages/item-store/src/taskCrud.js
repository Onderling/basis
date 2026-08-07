/**
 * taskCrud — the task CRUD + QUERY surface as FUNCTIONS-OVER-CircleItemStore.
 *
 * PLAN-capabilities-tasks-roles migration step 1 (the companion to
 * `taskLifecycle.js`). `taskLifecycle` ported the lifecycle VERBS (claim /
 * reassign / markComplete / submit / approve / reject / revoke). This module
 * ports the remaining `ItemStore` surface consumers (tasks-v0 et al.) still use:
 *   - `addTasks`   ⟵ ItemStore.addItems
 *   - `listOpen` / `listClosed` / `getById`   ⟵ ItemStore.listOpen/listClosed/getById
 *   - `update`     ⟵ ItemStore.update
 *   - `removeItems`⟵ ItemStore.removeItems
 * together with `taskLifecycle` that gives a COMPLETE functional surface to
 * migrate consumers onto, so the class `ItemStore` can be retired later.
 *
 * Behavioural PARITY with `ItemStore` — the same materialise defaults, the same
 * open/closed partition + filter semantics, the same forbidden-field guard on
 * update, the same gate points. The ONE deliberate shift is metadata convention:
 * `CircleItemStore` stamps the canonical BASE fields (`createdAt`/`createdBy`/
 * `updatedAt`/`updatedBy`) inside `put`, where the class `ItemStore` stamped its
 * own `addedAt`/`addedBy`/`_etag`. So `addTasks` builds the item BODY + defaults
 * and lets `store.put({ by: actor })` own the base metadata — exactly how the
 * lifecycle verbs already rely on `put`/`putIfMatch` to stamp it.
 *
 * ── ctx ──────────────────────────────────────────────────────────────────────
 * Same convention as `taskLifecycle`: `ctx.actor` (required), `ctx.rolePolicy`
 * (the gate), `ctx.actorDisplayName`, `ctx.emit` (the per-verb named-event seam).
 *
 * The shared ctx plumbing (`requireActor` / `gate` / `emit` / `resolveById`)
 * comes from `taskCtx.js` — the SAME helpers `taskLifecycle` uses, imported not
 * duplicated.
 */

import { ulid } from './ulid.js';
import { detectCycle } from './dag.js';
import { audienceFromItem, audienceMatches, audienceMatchesAny } from './audience.js';
import { ItemNotFoundError } from './errors.js';
import { requireActor, gate, emit, resolveById } from './taskCtx.js';

const TASK_TYPE = 'task';

// ── add ──────────────────────────────────────────────────────────────────────

/**
 * Add one or more tasks — parity with `ItemStore.addItems`.
 *
 * For each partial: validate shape → materialise (assign id + defaults) → run
 * the DAG **cycle check** on `dependencies[]` → gate `canAdd` → `store.put`
 * (which stamps `createdAt`/`createdBy`/`updatedAt`). Returns the created items.
 *
 * DAG cycle check — this is the guard that in the class-`ItemStore` world lived
 * in the tasks-v0 add-skill (`detectCycle({id:'__new__', dependencies}, listOpen)`
 * → throw `{code:'DEPENDENCY_CYCLE', cycle}`). It is ABSORBED here so the ported
 * surface is self-guarding and consumers can drop their copy. Same `detectCycle`
 * (from `dag.js`), same `DEPENDENCY_CYCLE` code, same cycle path.
 *
 * @param {import('./CircleItemStore.js').CircleItemStore} store
 * @param {Array<object>} partials  task partials ({ text, type?, dependencies?, … })
 * @param {object} ctx  `actor` required; `rolePolicy`, `actorDisplayName`, `emit` optional.
 * @returns {Promise<object[]>} the created items (with base metadata stamped by put).
 */
export async function addTasks(store, partials, ctx = {}) {
  if (!Array.isArray(partials) || partials.length === 0) return [];
  const actor = requireActor(ctx);
  const created = [];
  for (const partial of partials) {
    validatePartial(partial);
    const item = materialise(partial, ctx);
    // DAG cycle detection (parity with the tasks-v0 add-guard). Only when the
    // new item declares deps; walk them against the current OPEN task set.
    if (Array.isArray(item.dependencies) && item.dependencies.length > 0) {
      const all = await listOpen(store);
      const cycle = detectCycle({ id: item.id, dependencies: item.dependencies }, all);
      if (cycle) {
        throw Object.assign(
          new Error(`addTasks: dependency cycle would form: ${cycle.join(' → ')}`),
          { code: 'DEPENDENCY_CYCLE', cycle },
        );
      }
    }
    gate(ctx.rolePolicy, 'canAdd', actor, item);
    const res = await store.put(item, { by: actor });
    created.push(res);
    emit(ctx, 'item-added', res);
  }
  return created;
}

/**
 * Materialise a partial into a full item body — parity with `ItemStore#materialise`,
 * minus the class's own `addedAt`/`addedBy`/`_etag` (CircleItemStore.put owns the
 * canonical `createdAt`/`createdBy`/`updatedAt` base fields; see the module doc).
 * `id` is assigned here (needed BEFORE the cycle check) and preserved by `put`.
 */
function materialise(partial, ctx) {
  const id = (typeof partial.id === 'string' && partial.id) ? partial.id : ulid();
  return {
    id,
    type: (typeof partial.type === 'string' && partial.type) ? partial.type : TASK_TYPE,
    ...(partial.kind !== undefined ? { kind: partial.kind } : {}),
    text: partial.text,
    ...(partial.notes ? { notes: partial.notes } : {}),
    // COMPAT METADATA (parity with `ItemStore#materialise`). `CircleItemStore.put`
    // owns the canonical `createdAt`/`createdBy`/`updatedAt` base, but the LIVE
    // task authz + notifications still read the ItemStore-era `addedBy`/`addedAt`
    // convention pervasively (rolePolicy creator-approval + member-edits-own +
    // private-visibility, issuer notifications, subtask-spawn, dashboard, UI).
    // Stamp them here so a migrated consumer's stored task is field-compatible;
    // `addedBy` carries the same webid `createdBy` does, `addedAt` the numeric
    // clock ItemStore used. (`master` still defaults to the actor below.)
    addedBy: partial.addedBy ?? ctx.actor,
    ...(ctx.actorDisplayName ? { addedByDisplayName: ctx.actorDisplayName } : {}),
    addedAt: partial.addedAt ?? Date.now(),
    ...(partial.dependencies ? { dependencies: [...partial.dependencies] } : {}),
    ...(partial.requiredSkills ? { requiredSkills: [...partial.requiredSkills] } : {}),
    ...(partial.dueAt !== undefined ? { dueAt: partial.dueAt } : {}),
    ...(partial.visibility ? { visibility: partial.visibility } : {}),
    ...(partial.audience !== undefined ? { audience: partial.audience } : {}),
    ...(partial.source ? { source: partial.source } : {}),
    ...(partial.definitionOfDone ? { definitionOfDone: partial.definitionOfDone } : {}),
    ...(partial.approval ? { approval: partial.approval } : {}),
    // Co-ownership (J2): the claim ceiling declared at creation. Absent ⇒ default
    // 1 (EXCLUSIVE first-come) via `maxAssigneesOf`; a number/`null` ⇒ co-ownable.
    ...(partial.maxAssignees !== undefined ? { maxAssignees: partial.maxAssignees } : {}),
    // Claim confirmation MODE, declared at creation (the master's call): `'explicit'` holds a claim PENDING
    // until an authority confirms it; absent/`'auto'` ⇒ the first claim confirms itself (the subtask fix).
    ...(partial.claimConfirmation !== undefined ? { claimConfirmation: partial.claimConfirmation } : {}),
    // Claim LEASE (§2.8), ms — an unfinished claim auto-releases after `claimedAt + claimLease` (deterministic;
    // returns the node to claimable). Absent/0 ⇒ manual release only (the default). Set by the issuer.
    ...(partial.claimLease !== undefined ? { claimLease: partial.claimLease } : {}),
    ...(partial.scheduledAt !== undefined ? { scheduledAt: partial.scheduledAt } : {}),
    ...(partial.estimateMinutes !== undefined ? { estimateMinutes: partial.estimateMinutes } : {}),
    ...(Array.isArray(partial.embeds) && partial.embeds.length > 0
      ? { embeds: partial.embeds.map((e) => ({ type: e.type, ref: e.ref })) }
      : {}),
    master: partial.master ?? ctx.actor,
  };
}

/** Shape guard — parity with `ItemStore#validatePartial`. `type` defaults to
 * `'task'` here (this is the task surface), so only a supplied `type` is checked;
 * `text` is required non-empty as in ItemStore. */
function validatePartial(partial) {
  if (!partial || typeof partial !== 'object') {
    throw new TypeError('addTasks: each item must be an object');
  }
  if (partial.type !== undefined && (typeof partial.type !== 'string' || partial.type.length === 0)) {
    throw new TypeError('addTasks: `type` must be a non-empty string when provided');
  }
  if (typeof partial.text !== 'string' || partial.text.trim().length === 0) {
    throw new TypeError('addTasks: each item requires a non-empty `text`');
  }
}

// ── list / read ──────────────────────────────────────────────────────────────

/**
 * List OPEN items matching `filter`. "Open" = `completedAt` absent — parity with
 * `ItemStore.listOpen`, which scans ALL items (every type) then partitions +
 * filters. The single per-circle store holds mixed types (a task lives beside a
 * `chat-message` / `subtask-request` / `subtask-proposal` / `inbox-item`), and
 * LIVE consumers query them THROUGH this surface with `filter.type`; a bare
 * `listOpen()` returns every open item, exactly as `ItemStore` did. (Restricting
 * to `listByType('task')` would silently drop those other-typed queries.)
 */
export async function listOpen(store, filter) {
  const items = await store.list();
  return filterItems(items.filter((i) => !i.completedAt), filter);
}

/**
 * List CLOSED items matching `filter`. "Closed" = `completedAt` present — parity
 * with `ItemStore.listClosed` (scans ALL items; see `listOpen`).
 */
export async function listClosed(store, filter) {
  const items = await store.list();
  return filterItems(items.filter((i) => i.completedAt !== undefined && i.completedAt !== null), filter);
}

/** Read one task by id — parity with `ItemStore.getById` (thin over `store.get`). */
export async function getById(store, id) {
  return store.get(id);
}

/**
 * Filter predicate set — a faithful port of `ItemStore#filterItems`:
 * `type` · `requiredSkill` · `assignee` (incl. `null` = unassigned) · `audience`
 * (single, via the `audienceFromItem` bridge) · `audiences` (cross-circle set).
 */
function filterItems(items, filter) {
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
  if (filter.audience !== undefined) {
    out = out.filter((i) => audienceMatches(audienceFromItem(i), filter.audience));
  }
  if (filter.audiences !== undefined) {
    out = out.filter((i) => audienceMatchesAny(audienceFromItem(i), filter.audiences));
  }
  return out;
}

// ── update ───────────────────────────────────────────────────────────────────

/**
 * Immutable / dedicated-transition fields — parity with
 * `ItemStore#assertEditableFields`. The class list is preserved VERBATIM (its
 * `addedBy`/`addedAt` metadata names are harmless when absent — the guard only
 * fires on a field actually present in the patch), PLUS the CircleItemStore
 * metadata equivalents (`createdAt`/`createdBy`/`updatedAt`/`updatedBy`) and
 * `type` (the store keys by type, so a type flip would misplace the item).
 */
const FORBIDDEN_UPDATE_FIELDS = Object.freeze([
  // ── verbatim from ItemStore#assertEditableFields ──
  'id', 'addedBy', 'addedByDisplayName', 'addedAt',
  'completedAt', 'completedBy', 'completedByDisplayName',
  'assignee', 'assignees', 'claimedAt', 'claimBase',   // assignment state — set via claim/reassign/revoke, never update()
  'reviewLog',      // append-only via submit/approve/reject/revoke
  'deliverable',    // set via submit
  'approval',       // change via a dedicated approval-mode op
  'master',         // not user-editable through update()
  'parentTaskId',   // immutable after add
  // ── CircleItemStore metadata equivalents (same immutability guarantee) ──
  'type', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
]);

/**
 * Edit body fields (LWW) — parity with `ItemStore.update`. Rejects a patch that
 * touches any forbidden / dedicated-transition field (`FORBIDDEN_UPDATE_FIELDS`);
 * gates `canEditBody`; merges the patch and `store.put`s it. Emits `item-updated`.
 *
 * @returns {Promise<object>} the merged, stored item.
 */
export async function update(store, id, patch, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  assertEditableFields(patch);
  gate(ctx.rolePolicy, 'canEditBody', actor, current, patch);
  const updated = { ...current, ...patch };
  const res = await store.put(updated, { by: actor });
  emit(ctx, 'item-updated', res);
  return res;
}

function assertEditableFields(patch) {
  if (!patch || typeof patch !== 'object') return;
  for (const f of FORBIDDEN_UPDATE_FIELDS) {
    if (f in patch) {
      throw new TypeError(
        `update: field '${f}' is not editable through update(); use the dedicated primitive.`,
      );
    }
  }
}

// ── remove ───────────────────────────────────────────────────────────────────

/**
 * Hard-delete tasks — parity with `ItemStore.removeItems`. Resolves each ref to
 * an item (via the shared `resolveById`), gates `canRemove`, then `store.delete`s
 * it. Missing refs are skipped. Emits `item-removed` `{id, item}`. Returns the
 * removed ids (parity with ItemStore's `string[]` return).
 *
 * @returns {Promise<string[]>} the ids that were removed.
 */
export async function removeItems(store, refs, ctx = {}) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const actor = requireActor(ctx);
  const removed = [];
  for (const ref of refs) {
    const { item } = await resolveById(store, ref);
    if (!item) continue;
    gate(ctx.rolePolicy, 'canRemove', actor, item);
    await store.delete(item.id);
    removed.push(item.id);
    emit(ctx, 'item-removed', { id: item.id, item });
  }
  return removed;
}
