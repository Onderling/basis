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
import { parentsOf, contain } from './containment.js';

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

// ── claim confirmation (the subtask decentralized-tree fix) ──────────────────
//
// A claim is a REQUEST until it is CONFIRMED. Confirmation is what makes the claimant the SINGLE writer of the
// task's subtree — the property that lets the tree survive decentralization without a CRDT (see
// PLAN-subtask-claim-and-confirmation). Two modes, chosen by the task master at creation:
//   • 'auto' (default) — the first valid claim confirms itself (the master pre-delegates);
//   • 'explicit'       — the claim stays PENDING until an authority (master/admin/coordinator) confirms it.
// The confirmed claimant is `confirmedAssignee`; `confirmedAt`/`confirmedBy` attribute the confirmation.

/** The confirmation mode of a task — `'explicit'` iff set so, else `'auto'` (the least-friction default). */
export function confirmationModeOf(item) {
  return item?.claimConfirmation === 'explicit' ? 'explicit' : 'auto';
}

/** The confirmed claimant's id, or null when the claim is still pending / the task is unclaimed. */
export function confirmedClaimOf(item) {
  return item?.confirmedAssignee ?? null;
}

/** True iff `actor` holds the CONFIRMED claim (not merely a pending one). */
export function isConfirmedClaimant(item, actor) {
  return item?.confirmedAssignee != null && item.confirmedAssignee === actor;
}

/**
 * The claim state of a task, for projections/UX: `'unclaimed' | 'pending' | 'confirmed'`. A `pending` claim
 * has a claimant but no confirmation yet (explicit mode, awaiting the authority) — the "not yet yours" state.
 */
export function claimState(item) {
  if (item?.confirmedAssignee != null) return 'confirmed';
  if (assigneesOf(item).length > 0) return 'pending';
  return 'unclaimed';
}

/**
 * The canonical string a confirmer SIGNS to make a `claim-confirmed` authoritative — the facts that identify
 * exactly which claim, on which task, at which sequence. Stable + delimiter-separated so two devices produce
 * the same bytes. (The signing/verifying keys live in the identity layer, NOT here — this substrate only
 * canonicalises + carries `confirmedSig`; sign/verify are injected. Enforcement rides eviction-as-signed-
 * statement, task #2.)
 * @param {{taskId?:string, confirmedAssignee?:string, confirmedAt?:number, claimSeq?:number}} facts
 */
export function claimConfirmationStatement({ taskId, confirmedAssignee, confirmedAt, claimSeq } = {}) {
  return ['claim-confirmed', taskId ?? '', confirmedAssignee ?? '', confirmedAt ?? '', claimSeq ?? ''].join(' ');
}

/**
 * Verify a task's `confirmedSig` against its confirmation facts, using an injected `verify(message, sig)` (the
 * identity layer's Ed25519 verify bound to the confirmer's pubkey). Returns false when there is no signature /
 * no confirmed claimant, or the signature does not check out. A no-op-safe read — no crypto in the substrate.
 * @param {object} item
 * @param {(message:string, sig:string)=>boolean} verify
 */
export function verifyClaimConfirmation(item, verify) {
  const sig = item?.confirmedSig;
  if (!sig || item?.confirmedAssignee == null || typeof verify !== 'function') return false;
  const msg = claimConfirmationStatement({
    taskId: item.id, confirmedAssignee: item.confirmedAssignee, confirmedAt: item.confirmedAt, claimSeq: item.claimSeq,
  });
  try { return verify(msg, sig) === true; } catch { return false; }
}

/**
 * True iff the task's claim has LAPSED under its lease (§2.8): the issuer set a `claimLease` (duration in ms)
 * at creation and `claimedAt + claimLease` is in the past. A lapsed claim returns the node to claimable — an
 * unfinished claim no longer freezes its subtree. DETERMINISTIC: computed identically on every device from the
 * item's own fields + a `now` the caller supplies (principle 10 — nothing decided locally). No lease (the
 * default) ⇒ never expires (manual release only). A completed task never expires.
 * @param {object} item
 * @param {number} [now] epoch ms (caller-supplied so the fn stays pure/testable)
 */
export function isClaimExpired(item, now = 0) {
  const lease = typeof item?.claimLease === 'number' ? item.claimLease : null;
  if (!lease || lease <= 0) return false;
  if (item?.completedAt) return false;
  const since = typeof item?.claimedAt === 'number' ? item.claimedAt : null;
  if (since == null) return false;
  return (since + lease) < now;
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
  const at = Date.now();
  const roster = assigneesOf(current);
  // A claim that has LAPSED under its lease (§2.8) returns the node to claimable — a new claim SUPERSEDES it.
  const expired = isClaimExpired(current, at);
  // Already a co-owner, OR the set is full (default maxAssignees:1 ⇒ full after the first claim = today's
  // EXCLUSIVE first-come) → ItemStore's already-claimed — UNLESS the current claim has expired.
  if (!expired && (roster.includes(actor) || roster.length >= maxAssigneesOf(current))) {
    return { error: 'already-claimed', current };
  }
  gate(ctx.rolePolicy, 'canClaim', actor, current);

  // A fresh claim over an EXPIRED one drops the lapsed roster + its (now void) confirmation; otherwise CAS-ADD.
  const assignees = expired ? [actor] : [...roster, actor];
  const updated = {
    ...current, assignees, assignee: assignees[0], claimedAt: at,
    claimSeq: (current.claimSeq ?? 0) + 1,     // advance the claim's monotonic sequence (immutable-once-set)
  };
  delete updated.claimReleasedAt;              // a fresh claim clears a prior release marker (re-claim)
  if (expired) {                               // the lapsed claim's confirmation no longer holds
    delete updated.confirmedAssignee;
    delete updated.confirmedAt;
    delete updated.confirmedBy;
  }
  // Auto-confirm (default): unless the task requires EXPLICIT confirmation, the claim confirms itself — the
  // master pre-delegated (§2.3). A confirmed claim is what unlocks the subtree. In explicit mode the claim
  // stays PENDING (no `confirmedAssignee`) until an authority calls `confirmClaim`. An EXPIRED claim's old
  // confirmation is void, so the superseding claim re-confirms per the mode.
  const autoConfirm = confirmationModeOf(current) !== 'explicit' && (expired || current.confirmedAssignee == null);
  if (autoConfirm) {
    updated.confirmedAssignee = actor;
    updated.confirmedAt = at;
    updated.confirmedBy = current.master ?? current.addedBy ?? actor;   // the pre-delegating authority
    if (typeof ctx.sign === 'function') {
      updated.confirmedSig = ctx.sign(claimConfirmationStatement({
        taskId: id, confirmedAssignee: actor, confirmedAt: at, claimSeq: updated.claimSeq,
      }));
    }
  }
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  // CAS conflict → someone else claimed between our read and our write. Re-map
  // to ItemStore's contract; `res.current` is the re-read winner.
  if (res && res.error === 'conflict') {
    return { error: 'already-claimed', current: res.current ?? current };
  }
  emit(ctx, 'item-claimed', res);
  if (autoConfirm) emit(ctx, 'claim-confirmed', res);
  return res;
}

/**
 * Confirm a claim — AUTHORITATIVE (CAS). The authority (task master, or admin/coordinator via `rolePolicy`)
 * turns a PENDING claim into a real one: the confirmed claimant becomes the SINGLE writer of the subtree, so
 * `spawnSubtask` unlocks (see `canSpawnSubtask`). Confirms `ctx.assignee` when given, else the current sole
 * claimant; collapses the co-owner set to the confirmed claimant (confirmation RESOLVES a contested claim to
 * one). Emits `claim-confirmed`. Idempotent-safe: re-confirming the same claimant just re-stamps.
 *
 * @param {import('./CircleItemStore.js').CircleItemStore} store
 * @param {string} id
 * @param {object} ctx  `actor` required; `assignee` (the claim to confirm), `rolePolicy`, `expectedEtag`,
 *   `emit` optional.
 * @returns {Promise<object | {error:'conflict', current: object|null} | {error:'no-claim', current: object}>}
 */
export async function confirmClaim(store, id, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'confirmClaim' });
  }
  // The claim to confirm: an explicit target, else the current sole claimant.
  const target = ctx.assignee ?? assigneesOf(current)[0] ?? null;
  if (!target) return { error: 'no-claim', current };     // nothing pending to confirm
  gate(ctx.rolePolicy, 'canConfirmClaim', actor, current);

  const at = Date.now();
  const updated = {
    ...current,
    // Confirmation RESOLVES a contested claim to the one confirmed claimant (the master may confirm a claimant
    // who lost the local CAS but is the chosen one), so collapse the co-owner set to them.
    assignees: [target],
    assignee: target,
    claimedAt: current.claimedAt ?? at,
    confirmedAssignee: target,
    confirmedAt: at,
    confirmedBy: actor,
    claimSeq: (current.claimSeq ?? 0) + 1,     // an authoritative transition — supersedes a pending claim
  };
  delete updated.claimReleasedAt;
  // Optional cryptographic attestation: if the caller injects a signer (the confirmer's identity key), sign
  // the canonical confirmation statement so a peer CAN verify it (enforcement rides task #2's ingest rail).
  if (typeof ctx.sign === 'function') {
    updated.confirmedSig = ctx.sign(claimConfirmationStatement({
      taskId: id, confirmedAssignee: target, confirmedAt: at, claimSeq: updated.claimSeq,
    }));
  } else {
    delete updated.confirmedSig;               // a re-confirmation without a signer clears any stale signature
  }
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  if (res && res.error === 'conflict') return res;
  // Confirmation is the moment PROVISIONAL becomes real: commit the confirmed claimant's optimistic subtree
  // and discard any losing claimant's (§2.5).
  await commitProvisionalSubtree(store, id, target, actor, ctx);
  emit(ctx, 'claim-confirmed', res);
  return res;
}

/**
 * On confirmation, the confirmed claimant's PROVISIONAL children (spawned optimistically while the claim was
 * pending) become REAL — the `provisional` flag cleared, the parent embed + the `dependencies` completion gate
 * established. Any OTHER claimant's provisional children under the task are DISCARDED (the loser's optimistic
 * subtree, §2.5). A no-op when the store can't enumerate or there are none.
 */
async function commitProvisionalSubtree(store, parentId, confirmedAssignee, by, ctx = {}) {
  if (typeof store.list !== 'function') return;
  const all = await store.list();
  const kids = (all ?? []).filter((it) =>
    it?.provisional === true && Array.isArray(it.containedBy) && it.containedBy.includes(parentId));
  for (const kid of kids) {
    const authoredByWinner = kid.createdBy === confirmedAssignee || kid.master === confirmedAssignee;
    if (authoredByWinner) {
      await store.put({ ...kid, provisional: false }, { by });     // commit: no longer provisional
      await contain(store, parentId, kid.id);                       // establish the parent embed
      const parent = await store.get(parentId);
      const deps = Array.isArray(parent?.dependencies) ? parent.dependencies : [];
      if (!deps.includes(kid.id)) await store.put({ ...parent, dependencies: [...deps, kid.id] }, { by });
      emit(ctx, 'subtask-committed', { task: { ...kid, provisional: false }, parentId });
    } else {
      await store.delete(kid.id);                                   // discard a losing claimant's optimistic child
      emit(ctx, 'subtask-discarded', { taskId: kid.id, parentId });
    }
  }
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
  // Reassign/release is an AUTHORITATIVE transition (coordinator+); advance the claim sequence so it
  // supersedes any stale claim on a peer (the merge keeps the higher-sequence side).
  const updated = { ...current, claimBase: current.assignee ?? null, claimSeq: (current.claimSeq ?? 0) + 1 };
  if (newAssignee) {
    // Reassign to a new SOLE owner: collapse the co-owner set to just them, and re-confirm them (a
    // coordinator reassignment is inherently authoritative → the new assignee is the confirmed claimant).
    updated.assignees = [newAssignee];
    updated.assignee = newAssignee;            // mirror = assignees[0]
    updated.claimedAt = at;
    updated.confirmedAssignee = newAssignee;
    updated.confirmedAt = at;
    updated.confirmedBy = actor;
    delete updated.claimReleasedAt;
  } else {
    // Release: clear the whole set + the mirror + the confirmation; stamp the release marker so the merge
    // knows this is a deliberate un-claim (not a stale claimless edit).
    delete updated.assignees;
    delete updated.assignee;
    delete updated.claimedAt;
    delete updated.confirmedAssignee;
    delete updated.confirmedAt;
    delete updated.confirmedBy;
    updated.claimReleasedAt = at;
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
  // Revoke is an AUTHORITATIVE transition — advance the claim sequence so it supersedes a stale claim on a peer.
  const updated = { ...current, reviewLog, claimSeq: (current.claimSeq ?? 0) + 1 };
  let previousAssignee;
  if (target && roster.includes(target) && roster.length > 1) {
    // Yank ONE co-owner; the rest keep the task. If the yanked one was the confirmed claimant, the
    // confirmation is now stale — clear it (the remaining co-owners hold a plain claim until re-confirmed).
    const remaining = roster.filter((w) => w !== target);
    updated.assignees = remaining;
    updated.assignee = remaining[0];           // mirror = new assignees[0]
    if (current.confirmedAssignee === target) {
      delete updated.confirmedAssignee;
      delete updated.confirmedAt;
      delete updated.confirmedBy;
    }
    previousAssignee = target;
  } else {
    // Clear the whole set + the mirror + confirmation (single-owner parity); stamp the release marker so the
    // merge treats this as a deliberate un-claim rather than a stale claimless edit.
    previousAssignee = current.assignee;
    delete updated.assignees;
    delete updated.assignee;
    delete updated.claimedAt;
    delete updated.confirmedAssignee;
    delete updated.confirmedAt;
    delete updated.confirmedBy;
    updated.claimReleasedAt = at;
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
 * AUTHORITY — the capability gate is WIRED at this verb: `gate(ctx.rolePolicy, 'canSpawnSubtask', actor,
 * parent)` — item-relative parent-assignee/master + role, per architecture's "task authority rides the one
 * PolicyEngine" + the enforceability principle. Note it binds on the WRITE side only: inbound peer sync
 * (`circleStoreInbound.js`) is a raw causal `put` with no authority check, so a divergent client that calls
 * `put` directly is NOT rejected by peers — the verb gate is convention-strength until an ingest-side
 * authority check is added (deliberately deferred: a circle is trusted people, per the enforceability
 * principle). Actor is required; a completed parent is refused; the spawner is the subtask's `master` by
 * default (parity with tasks-v0).
 *
 * DEPTH-APPROVAL: a subtask deeper than the circle's spawn-approval depth (`ctx.approvalDepth`, default
 * `DEFAULT_SUBTASK_APPROVAL_DEPTH`) is HELD — NOT created — and returns `{ queued: true, depth, threshold }`.
 * The depth LIMIT is enforced here; the approval-request item + admin approve/decline is the consumer's
 * workflow (fed by this signal), so no bespoke request type leaks into the item-store.
 *
 * @returns {Promise<{ queued: false, task: object, depth: number } | { queued: true, depth: number, threshold: number }>}
 */
export const DEFAULT_SUBTASK_APPROVAL_DEPTH = 3;

export async function spawnSubtask(store, parentId, args = {}, ctx = {}) {
  const actor = requireActor(ctx);
  if (typeof args.text !== 'string' || !args.text.trim()) throw new MissingArgumentError({ argument: 'text' });
  const parent = await store.get(parentId);
  if (!parent) throw new ItemNotFoundError(parentId);
  if (parent.completedAt) {
    throw new InvalidLifecycleError({ itemId: parentId, currentState: 'completed', attemptedAction: 'spawnSubtask' });
  }
  // Authority TIER — the capability gate AT the canonical verb (the enforceability principle: put the gate
  // where it binds). A CONFIRMED claimant / master / admin spawns a COMMITTED subtask (`canSpawnSubtask`). A
  // PENDING (unconfirmed) claimant may still spawn OPTIMISTICALLY while partitioned — a PROVISIONAL subtask
  // that does NOT gate the parent and is committed on confirmation / discarded if the claim loses (offline
  // autonomy, §2.5). Anyone else is denied. (A missing policy/predicate = allow — the gate's documented default.)
  let provisional = false;
  try {
    gate(ctx.rolePolicy, 'canSpawnSubtask', actor, parent);
  } catch (denied) {
    if (isAssignee(parent, actor) && !isConfirmedClaimant(parent, actor)) {
      provisional = true;
    } else {
      throw denied;
    }
  }

  const depth = 1 + await depthOfContained(store, parentId);          // the child would be one deeper than the parent

  if (provisional) {
    // Child-side edge ONLY (`containedBy`) — a pending claimant must NOT write the parent (that is exactly the
    // clobber the confirmed-claim gate prevents). No `dependencies` gate; marked `provisional` until the claim
    // is confirmed. `confirmClaim` commits these (or discards a loser's) — the moment provisional becomes real.
    const child = await store.put({
      type:   args.type ?? 'task',
      text:   args.text,
      master: args.master ?? actor,
      containedBy: [parentId],
      provisional: true,
      ...(args.notes            !== undefined ? { notes:            args.notes }            : {}),
      ...(args.requiredSkills   !== undefined ? { requiredSkills:   args.requiredSkills }   : {}),
      ...(args.dueAt            !== undefined ? { dueAt:            args.dueAt }            : {}),
      ...(args.visibility       !== undefined ? { visibility:       args.visibility }       : {}),
      ...(args.definitionOfDone !== undefined ? { definitionOfDone: args.definitionOfDone } : {}),
      ...(args.approval         !== undefined ? { approval:         args.approval }         : {}),
    }, { by: actor });
    emit(ctx, 'subtask-spawned-provisional', { task: child, parentId, depth });
    return { queued: false, provisional: true, task: child, depth };
  }

  // Depth-approval — enforce the circle's spawn-approval depth HERE (canonical). A subtask deeper than the
  // threshold is HELD, not created directly: return a `{ queued: true }` signal instead. The depth LIMIT is
  // canonical; FILING the approval request + the admin approve/decline is the consumer's workflow (it owns
  // the bespoke request item), fed by this signal — so a bespoke type never leaks into the item-store.
  // Threshold is injected (`ctx.approvalDepth`, a per-circle setting); default `DEFAULT_SUBTASK_APPROVAL_DEPTH`.
  const threshold = Number.isFinite(ctx.approvalDepth) ? ctx.approvalDepth : DEFAULT_SUBTASK_APPROVAL_DEPTH;
  if (depth > threshold) {
    emit(ctx, 'subtask-spawn-held', { parentId, depth, threshold, by: actor });
    return { queued: true, depth, threshold };
  }

  // Within the depth — create the child + establish containment (contains embed on the parent + containedBy
  // on the child), via the shared primitive — no re-implementation, no parentTaskId.
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
  emit(ctx, 'subtask-spawned', { task: child, depth });
  return { queued: false, task: child, depth };
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
 * 1. parentTaskId → containment migration — DONE. The structural parent/child edge is now CONTAINMENT
 *    (`containedBy` on the child; `contain` / `containerOps.js`); `dependencies[]` stays the DAG completion
 *    gate. `spawnSubtask` carries the confirmed-claim authz + depth-approval; the tasks-v0 spawn writers and
 *    tree readers were ported off `parentTaskId` (it is retired — no writer sets it, no reader reads it as a
 *    tree edge). See the subtask claim-confirmation arc.
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
