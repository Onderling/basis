/**
 * taskLifecycle — the task lifecycle VERBS as FUNCTIONS-OVER-CircleItemStore.
 *
 * PLAN-capabilities-tasks-roles keystone (Option A, DECIDED 2026-07-18).
 *
 * `CircleItemStore` is the canonical, deliberately-minimal per-circle store
 * (generic typed CRUD + a type index + a CAS write path). The task lifecycle —
 * `claim` / `reassign` / `markComplete` / `submit` / `approve` / `reject` /
 * `revoke` — that `ItemStore` baked into the class lives HERE as pure functions
 * over the thin store, exactly the "type-specific lifecycle lives in functions
 * over this store, not baked in here" philosophy in the CircleItemStore header.
 *
 * These functions are a behavioural PARITY port of `ItemStore`'s verbs. The one
 * real design difference is the concurrency model (the plan's "★ ARCHITECTURAL
 * CHOICE"):
 *   - AUTHORITATIVE ops that must be winner-take-all — `claim`, `reassign`,
 *     `approve` — go through `store.putIfMatch` (the DataSource-level etag CAS,
 *     the SAME mechanism `ItemStore.#casWriteOrConflict` uses). A racing second
 *     writer is REJECTED, not causally merged. `putIfMatch` returns
 *     `{ error:'conflict', current }` on a precondition failure; `claim` re-maps
 *     that to `ItemStore`'s `{ error:'already-claimed', current }` contract.
 *   - CONTENT / status ops — `markComplete`, `submit`, `reject`, `revoke` — go
 *     through `store.put` (the causal path). These mirror `ItemStore`'s LWW
 *     body/completion merge.
 *
 * ── Injected context (`ctx`) ────────────────────────────────────────────────
 * `ItemStore` carried `rolePolicy` + `enforceDependencies` as constructor state
 * and audited/emitted internally. These functions are stateless, so those move
 * into `ctx`:
 *   - `ctx.actor`               (required) webid performing the action.
 *   - `ctx.actorDisplayName`    optional display snapshot (parity with ItemStore).
 *   - `ctx.rolePolicy`          the `RolePolicy` gate (default: no-op = allow).
 *   `ctx.enforceDependencies` DAG gate on close-transitions (default false).
 *   - `ctx.actionOverride`      force-complete admin path (bypasses the DAG gate).
 *   - `ctx.reason`              optional reason (parity; surfaced to `ctx.emit`).
 *   - `ctx.expectedEtag`        optional base etag the caller read — threaded to
 *                               `putIfMatch` for the genuine winner-take-all race.
 *   - `ctx.emit`                optional `(eventName, payload) => void` — the
 *                               EVENT SEAM (see below).
 *
 * ── Event seam ──────────────────────────────────────────────────────────────
 * `ItemStore extends Emitter` and emits `item-claimed` / `item-completed` / … .
 * `CircleItemStore` is not an emitter; its propagation seam is the publish-on-
 * write SYNC HOOK (`setSyncHook` → `publishItem`) that `put`/`putIfMatch` already
 * fire. So a successful lifecycle write fans out through that hook automatically
 * (no extra wiring). For consumers that want the RICH, per-verb named events
 * ItemStore emitted (`item-claimed` vs `item-completed` vs …), pass `ctx.emit`
 * and these functions call it with the same event names — mirroring ItemStore.
 *
 * ── NOT audited ─────────────────────────────────────────────────────────────
 * `ItemStore` also appends an append-only audit entry per verb under
 * `<root>/audit/`. `CircleItemStore` does NOT model an audit log, and this module
 * only has the store's public surface (no raw DataSource access). Audit parity is
 * a SEPARATE seam — see the TODO block at the bottom.
 */

import { computeStatus } from './lifecycleStatus.js';   // pure, shared status fn (reused, not reimplemented)
import {
  ItemNotFoundError,
  InvalidLifecycleError,
  MissingArgumentError,
  DependenciesOpenError,
} from './errors.js';
// Shared ctx plumbing (actor/gate/emit/ref-resolution) lives ONCE in taskCtx.js
// and is reused by both this module and taskCrud.js — no duplicated gate logic.
import { requireActor, gate, emit, resolveById } from './taskCtx.js';
// Structural subtask edge — the item-store CONTAINMENT model (the same tree treeOf renders and
// shareContainerTree walks), reused rather than tasks-v0's immutable `parentTaskId` field.
import { addChildTo } from './containerOps.js';
import { parentsOf } from './containment.js';

// ── co-ownership model (assignees[] + the `assignee` mirror) ─────────────────
//
// PLAN-cluster-verification-journeys J2 (co-ownership). A task's authoritative
// owner set is `assignees[]` (an array of webids); `maxAssignees` (default 1) caps
// it. `assignee` (singular) is kept as a MIRROR of `assignees[0]` so every legacy
// consumer read — `computeStatus`'s `if (item.assignee)`, the rolePolicy gates, the
// filter/dashboard/UI `item.assignee === actor` checks — keeps working by
// construction. These helpers are the ONE place the model is interpreted, and they
// tolerate legacy items that carry only `assignee` (no `assignees[]` yet).

/**
 * The co-owner set for a task. Source of truth is `assignees[]`; falls back to
 * `[assignee]` for legacy / single-owner items written before this field existed
 * (so membership queries keep working by construction). Empty ⇒ unclaimed.
 * @returns {string[]}
 */
export function assigneesOf(item) {
  if (Array.isArray(item?.assignees)) return item.assignees;
  if (item?.assignee) return [item.assignee];
  return [];
}

/**
 * The claim ceiling. `undefined` ⇒ 1 (today's EXCLUSIVE first-come default —
 * a 2nd claimer gets `already-claimed`, so J1 stays green); `null` ⇒ unlimited
 * (`Infinity`); a positive number ⇒ that cap (CO-OWNABLE).
 * @returns {number}
 */
export function maxAssigneesOf(item) {
  const m = item?.maxAssignees;
  if (m === null) return Infinity;
  if (typeof m === 'number' && Number.isFinite(m) && m >= 1) return Math.floor(m);
  return 1;
}

/** True iff the co-owner set has no room for another claimer (default-full-at-1). */
export function isAssigneesFull(item) {
  return assigneesOf(item).length >= maxAssigneesOf(item);
}

/** True iff `actor` is one of the task's co-owners (membership, not equality). */
export function isAssignee(item, actor) {
  return assigneesOf(item).includes(actor);
}

// ── lifecycle-specific helpers ───────────────────────────────────────────────

/**
 * DAG gate — parity with `ItemStore._assertDepsClosed`. Walk
 * `item.dependencies[]`, read each, and throw `DependenciesOpenError` if any is
 * open (present + uncompleted). Removed-or-missing deps are treated as satisfied
 * (don't block forever). `dependencies[]` is the DAG completion gate ONLY;
 * structural subtask nesting is the separate -containment migration (below).
 */
async function assertDepsClosed(store, item) {
  const deps = Array.isArray(item?.dependencies) ? item.dependencies : [];
  if (deps.length === 0) return;
  const open = [];
  for (const depId of deps) {
    if (typeof depId !== 'string' || !depId) continue;
    const dep = await store.get(depId);
    if (!dep) continue;                    // missing → treat as satisfied
    if (!dep.completedAt) open.push(depId);
  }
  if (open.length > 0) {
    throw new DependenciesOpenError({ itemId: item.id, openDeps: open });
  }
}

// ── Lifecycle verbs ──────────────────────────────────────────────────────────

/**
 * Claim a task — AUTHORITATIVE, race-safe (the whole point of Option A), now
 * CO-OWNERSHIP-aware. CAS-ADDS the actor to `assignees[]` (via `store.putIfMatch`,
 * so a racing second writer that read the same base loses) IF the actor is not
 * already a co-owner AND the set has room (`assignees.length < maxAssignees`).
 * Otherwise — already a co-owner, OR the set is FULL — returns the ItemStore-parity
 * `{error:'already-claimed', current}`. With the DEFAULT `maxAssignees:1` the set
 * is full after the first claim, so a 2nd claimer gets `already-claimed`: EXACTLY
 * today's exclusive first-come behaviour (J1 stays green). `putIfMatch`'s
 * `{error:'conflict', current}` is re-mapped to the same `already-claimed` shape.
 * Maintains the `assignee = assignees[0]` mirror + `claimedAt`.
 *
 * @param {import('./CircleItemStore.js').CircleItemStore} store
 * @param {string} id
 * @param {object} ctx  see module doc (`actor` required; `rolePolicy`,
 *   `expectedEtag`, `emit` optional).
 * @returns {Promise<object | {error:'already-claimed', current: object|null}>}
 */
export async function claim(store, id, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'claim' });
  }
  const roster = assigneesOf(current);
  // Already a co-owner, OR the set is full (default maxAssignees:1 ⇒ full after
  // the first claim = today's EXCLUSIVE first-come) → ItemStore's already-claimed.
  if (roster.includes(actor) || roster.length >= maxAssigneesOf(current)) {
    return { error: 'already-claimed', current };
  }
  gate(ctx.rolePolicy, 'canClaim', actor, current);

  const at = Date.now();
  const assignees = [...roster, actor];        // CAS-ADD (append, not overwrite)
  const updated = { ...current, assignees, assignee: assignees[0], claimedAt: at };
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  // CAS conflict → someone else claimed between our read and our write. Re-map
  // to ItemStore's contract; `res.current` is the re-read winner.
  if (res && res.error === 'conflict') {
    return { error: 'already-claimed', current: res.current ?? current };
  }
  emit(ctx, 'item-claimed', res);
  return res;
}

/**
 * Reassign a task — AUTHORITATIVE (CAS). Parity with `ItemStore.reassign`:
 * forbids reassigning a completed item; gates `canReassign`; sets
 * `assignee`+`claimedAt` (or clears both when `newAssignee` is falsy — release);
 * records `claimBase` (the superseded assignee) for the substrate mirror's
 * causal-vs-concurrent disambiguation. Emits `item-claimed` on assign,
 * `item-updated` on release. A CAS conflict is surfaced as
 * `{error:'conflict', current}` (authoritative op — the caller retries against
 * the fresh state rather than silently clobbering).
 *
 * @returns {Promise<object | {error:'conflict', current: object|null}>}
 */
export async function reassign(store, id, newAssignee, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'reassign' });
  }
  gate(ctx.rolePolicy, 'canReassign', actor, current);

  const at = Date.now();
  // `claimBase` records the SUPERSEDED sole owner (the mirror = assignees[0]) for
  // the substrate's causal-vs-concurrent disambiguation — preserved verbatim.
  const updated = { ...current, claimBase: current.assignee ?? null };
  if (newAssignee) {
    // Reassign to a new SOLE owner: collapse the co-owner set to just them.
    updated.assignees = [newAssignee];
    updated.assignee = newAssignee;            // mirror = assignees[0]
    updated.claimedAt = at;
  } else {
    // Release: clear the whole set + the mirror.
    delete updated.assignees;
    delete updated.assignee;
    delete updated.claimedAt;
  }
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  if (res && res.error === 'conflict') return res;
  emit(ctx, newAssignee ? 'item-claimed' : 'item-updated', res);
  return res;
}

/**
 * Mark items complete — CONTENT op (causal `put`, LWW completion, parity with
 * `ItemStore.markComplete`). For each ref: not-found + explicit → throw
 * `ItemNotFoundError`; already-completed + explicit → `InvalidLifecycleError`;
 * gate `canComplete`; DAG gate (`assertDepsClosed`) unless
 * `ctx.actionOverride`; stamp `completedAt`/`completedBy`; write; emit
 * `item-completed`.
 *
 * @param {import('./CircleItemStore.js').CircleItemStore} store
 * @param {Array<{id?:string}|string>} refs  explicit id refs (see `resolveById`)
 * @param {object} ctx
 * @returns {Promise<object[]>} the completed items
 */
export async function markComplete(store, refs, ctx = {}) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const actor = requireActor(ctx);
  const completed = [];
  for (const ref of refs) {
    const { id, item, explicit } = await resolveById(store, ref);
    if (!item) {
      if (explicit) throw new ItemNotFoundError(id);
      continue;
    }
    if (item.completedAt) {
      if (explicit) {
        throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'complete' });
      }
      continue;
    }
    gate(ctx.rolePolicy, 'canComplete', actor, item);
    if (ctx.enforceDependencies && !ctx.actionOverride) {
      await assertDepsClosed(store, item);
    }
    const at = Date.now();
    const updated = {
      ...item,
      completedAt: at,
      completedBy: actor,
      ...(ctx.actorDisplayName ? { completedByDisplayName: ctx.actorDisplayName } : {}),
    };
    const res = await store.put(updated, { by: actor });
    completed.push(res);
    emit(ctx, 'item-completed', res);
  }
  return completed;
}

/**
 * Submit a claimed item for approval — CONTENT op. Parity with
 * `ItemStore.submit`: allowed from `claimed` / `submitted` (re-submit) /
 * `rejected` (re-work); gate `canSubmit`; append a `submit` reviewLog entry;
 * carry the optional deliverable (stamped `submittedAt`). Emits `item-submitted`.
 */
export async function submit(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'submit' });
  }
  const status = computeStatus(current);
  if (status !== 'claimed' && status !== 'submitted' && status !== 'rejected') {
    throw new InvalidLifecycleError({ itemId: id, currentState: status, attemptedAction: 'submit' });
  }
  gate(ctx.rolePolicy, 'canSubmit', actor, current);

  const at = Date.now();
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'submit', note: args?.note });
  const deliverable = args?.deliverable ? { ...args.deliverable, submittedAt: at } : current.deliverable;
  const updated = {
    ...current,
    reviewLog,
    ...(deliverable ? { deliverable } : {}),
  };
  const res = await store.put(updated, { by: actor });
  emit(ctx, 'item-submitted', res);
  return res;
}

/**
 * Approve a submitted item — AUTHORITATIVE (CAS; the sign-off is winner-take-all).
 * Parity with `ItemStore.approve`: requires `submitted`; gate `canApprove`;
 * DAG gate unless `ctx.actionOverride`; append an `approve` reviewLog entry;
 * stamp `completedAt`/`completedBy`. Emits `item-completed`. A CAS conflict is
 * surfaced as `{error:'conflict', current}`.
 *
 * @returns {Promise<object | {error:'conflict', current: object|null}>}
 */
export async function approve(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'approve' });
  }
  const status = computeStatus(current);
  if (status !== 'submitted') {
    throw new InvalidLifecycleError({ itemId: id, currentState: status, attemptedAction: 'approve' });
  }
  gate(ctx.rolePolicy, 'canApprove', actor, current);
  if (ctx.enforceDependencies && !ctx.actionOverride) {
    await assertDepsClosed(store, current);
  }

  const at = Date.now();
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'approve', note: args?.note });
  const updated = {
    ...current,
    reviewLog,
    completedAt: at,
    completedBy: actor,
    ...(ctx.actorDisplayName ? { completedByDisplayName: ctx.actorDisplayName } : {}),
  };
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  if (res && res.error === 'conflict') return res;
  emit(ctx, 'item-completed', res);
  return res;
}

/**
 * Reject a submitted item — CONTENT op. Parity with `ItemStore.reject`:
 * mandatory `args.note` (`MissingArgumentError`); requires `submitted`; gate
 * `canReject`; append a `reject` reviewLog entry (→ `computeStatus` reports
 * `rejected`, distinct from `claimed`). Emits `item-rejected`.
 */
export async function reject(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  if (!args?.note || typeof args.note !== 'string' || !args.note.trim()) {
    throw new MissingArgumentError({ itemId: id, action: 'reject', argument: 'note' });
  }
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'reject' });
  }
  const status = computeStatus(current);
  if (status !== 'submitted') {
    throw new InvalidLifecycleError({ itemId: id, currentState: status, attemptedAction: 'reject' });
  }
  gate(ctx.rolePolicy, 'canReject', actor, current);

  const at = Date.now();
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'reject', note: args.note });
  const res = await store.put({ ...current, reviewLog }, { by: actor });
  emit(ctx, 'item-rejected', res);
  return res;
}

/**
 * Revoke an assignment — CONTENT op. Parity with `ItemStore.revoke`: mandatory
 * `args.reason` (`MissingArgumentError`); forbids on completed / unassigned
 * (`InvalidLifecycleError` — the mirror empty ⇒ unassigned); gate `canRevoke`;
 * append a `revoke` reviewLog entry; `master` preserved. Emits `item-revoked`
 * with `{item, previousAssignee, reason}`.
 *
 * CO-OWNERSHIP: `args.assignee` (or `args.target`) optionally names WHICH co-owner
 * to yank — when it names a member of a multi-owner set, only that one is removed
 * (the mirror re-points to the new `assignees[0]`). With no target — or a
 * single-owner set — the whole set clears (→ `computeStatus` returns `open`),
 * EXACTLY today's single-owner revoke (parity preserved).
 */
export async function revoke(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  if (!args?.reason || typeof args.reason !== 'string' || !args.reason.trim()) {
    throw new MissingArgumentError({ itemId: id, action: 'revoke', argument: 'reason' });
  }
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'revoke' });
  }
  if (!current.assignee) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'open', attemptedAction: 'revoke' });
  }
  gate(ctx.rolePolicy, 'canRevoke', actor, current);

  const at = Date.now();
  const roster = assigneesOf(current);
  const target = args?.assignee ?? args?.target ?? null;
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'revoke', note: args.reason });
  const updated = { ...current, reviewLog };
  let previousAssignee;
  if (target && roster.includes(target) && roster.length > 1) {
    // Yank ONE co-owner; the rest keep the task.
    const remaining = roster.filter((w) => w !== target);
    updated.assignees = remaining;
    updated.assignee = remaining[0];           // mirror = new assignees[0]
    previousAssignee = target;
  } else {
    // Clear the whole set + the mirror (single-owner parity).
    previousAssignee = current.assignee;
    delete updated.assignees;
    delete updated.assignee;
    delete updated.claimedAt;
  }
  const res = await store.put(updated, { by: actor });
  emit(ctx, 'item-revoked', { item: res, previousAssignee, reason: args.reason });
  return res;
}

// Re-export the pure lifecycle status fn so consumers can `import { computeStatus }
// from '.../taskLifecycle.js'` alongside the verbs. (The DAG-aware status —
// ready/waiting/blocked, "waiting until subtasks/deps complete" — is
// `computeDagStatus` in `dag.js`; this is the substrate lifecycle status.)
/**
 * spawnSubtask — create a child task CONTAINED by `parentId`, on the item-store CONTAINMENT model
 * (`contain`/`containedBy` — the SAME tree `treeOf` renders and `shareContainerTree` walks), NOT tasks-v0's
 * immutable `parentTaskId` field. It ALSO wires the child into the parent's `dependencies[]`, so
 * `computeDagStatus` holds the parent `waiting` until the subtask completes: containment is the structural
 * TREE, `dependencies[]` is the DAG completion GATE — two edges, both kept (architecture §3.4).
 *
 * STRUCTURAL only — there is deliberately NO authority gate yet: the capability gate
 * (`gate(ctx.rolePolicy, <spawn>, actor, parent)` — item-relative parent-assignee/master + role, per
 * architecture's "task authority rides the one PolicyEngine" + the enforceability principle) is a separate
 * later step, landing BEFORE any consumer adopts this (per the taskLifecycle note below: establish the
 * canonical function + prove parity first). Actor is required; a completed parent is refused; the spawner is
 * the subtask's `master` by default (parity with tasks-v0).
 *
 * @returns {Promise<{ task: object, depth: number }>}  the stored child + its containment depth (root=0)
 */
export async function spawnSubtask(store, parentId, args = {}, ctx = {}) {
  const actor = requireActor(ctx);
  if (typeof args.text !== 'string' || !args.text.trim()) throw new MissingArgumentError({ argument: 'text' });
  const parent = await store.get(parentId);
  if (!parent) throw new ItemNotFoundError(parentId);
  if (parent.completedAt) {
    throw new InvalidLifecycleError({ itemId: parentId, currentState: 'completed', attemptedAction: 'spawnSubtask' });
  }
  // Authority — the capability gate AT the canonical verb (the enforceability principle: put the gate where
  // it binds). The
  // circle's rolePolicy decides `canSpawnSubtask(actor, parent)` — item-relative (parent's assignee/master)
  // + role (coordinator/admin) — the tasks-v0 spawn perms expressed as a capability, not an inline
  // `circle.roles[from]` check. A missing policy/predicate = allow (the gate's documented default).
  gate(ctx.rolePolicy, 'canSpawnSubtask', actor, parent);
  // Create the child + establish containment (contains embed on the parent + containedBy on the child), via
  // the shared primitive — no re-implementation, no parentTaskId.
  const child = await addChildTo(store, parentId, {
    type:   args.type ?? 'task',
    text:   args.text,
    master: args.master ?? actor,           // the spawner owns the subtask by default (tasks-v0 parity)
    ...(args.notes            !== undefined ? { notes:            args.notes }            : {}),
    ...(args.requiredSkills   !== undefined ? { requiredSkills:   args.requiredSkills }   : {}),
    ...(args.dueAt            !== undefined ? { dueAt:            args.dueAt }            : {}),
    ...(args.visibility       !== undefined ? { visibility:       args.visibility }       : {}),
    ...(args.definitionOfDone !== undefined ? { definitionOfDone: args.definitionOfDone } : {}),
    ...(args.approval         !== undefined ? { approval:         args.approval }         : {}),
  });
  // DAG completion gate: the parent is `waiting` until the subtask completes. `addChildTo` re-put the parent
  // (the contains edge), so re-read before appending the dep.
  const fresh = await store.get(parentId);
  const deps = Array.isArray(fresh?.dependencies) ? fresh.dependencies : [];
  if (!deps.includes(child.id)) await store.put({ ...fresh, dependencies: [...deps, child.id] });
  const depth = await depthOfContained(store, child.id);
  emit(ctx, 'subtask-spawned', { task: child, depth });
  return { task: child, depth };
}

/** Containment depth of `id`: 0 at a root (no container), else 1 + the deepest containing path. Cycle-guarded. */
async function depthOfContained(store, id, seen = new Set()) {
  if (seen.has(id)) return 0;
  seen.add(id);
  const parents = await parentsOf(store, id);
  let max = 0;
  for (const p of parents) max = Math.max(max, 1 + await depthOfContained(store, p, seen));
  return max;
}

export { computeStatus };

// ── Module-private helpers (parity with ItemStore's) ─────────────────────────

/** Append-only reviewLog writer — returns a NEW array (parity with `_appendReview`). */
function appendReview(prev, entry) {
  const arr = Array.isArray(prev) ? [...prev] : [];
  arr.push(entry);
  return arr;
}

/*
 * ── TODO seams — LATER steps (deliberately NOT done here) ─────────────────
 *
 * 1. parentTaskId → containment migration.
 *    `dependencies[]` is kept as the DAG completion gate ONLY (above). The
 *    structural parent/child ("is a subtask of") currently ridden on tasks-v0's
 *    immutable `parentTaskId` must move onto containment (`contain` /
 *    `containedBy`, see `containment.js` / `containerOps.js`; `treeOf` already
 *    renders deps + containment as one tree). CAVEAT (from the -SPIKE VERDICT):
 *    `parentTaskId` is load-bearing for authz (spawn perms, master inheritance,
 *    depth-approval) — migrate carefully, not a field swap. These verbs read no
 *    `parentTaskId`; wire the containment-aware spawn/authz here when that step
 *    lands.
 *
 * 2. Consumer migration (tasks-v0 → these functions).
 *    `apps/tasks-v0` (+ stoop/household/presence-v0/tasks-mobile) still call
 *    `ItemStore`'s methods. Swapping them to `import { claim, … } from
 *    '@onderling/item-store'` over a `CircleItemStore` is the SEPARATE next step.
 *    Do NOT edit those apps or `ItemStore.js` in this pass — this module only
 *    establishes the canonical functions + proves parity.
 *
 * 3. Audit-log parity.
 *    `ItemStore` appends an append-only `<root>/audit/<id>.json` entry per verb.
 *    `CircleItemStore` models no audit log and these functions only touch its
 *    public surface. When the audit seam is designed for the per-circle store,
 *    thread the same `{action, actor, at, details}` entries from these verbs
 *    (the `ctx.reason` / display-name fields are already carried for it).
 *
 * 4. Event seam.
 *    Successful writes fan out via CircleItemStore's `setSyncHook` (publish-on-
 *    write) automatically. For ItemStore-parity NAMED events, pass `ctx.emit`
 *    (wired above). A consumer wanting the old `Emitter` surface can adapt
 *    `ctx.emit` → `store`-level events at the app boundary.
 */
