/**
 * H4 skill definitions — `defineSkill` shape.
 *
 * Migrated 2026-05-04 from the legacy `(args, ctx) => result` shape (which
 * required the `composeAgent` synthetic-agent shim) to the SDK-native
 * `({parts, from, agent}) => Parts[]` shape.  Handlers register on a real
 * `core.Agent` and dispatch via `core.taskExchange.handleTaskRequest`.
 *
 * Wire convention: each skill takes a single `DataPart` whose `data`
 * field carries the JSON args, and returns a JSON object that
 * SkillRegistry auto-wraps into a single `DataPart` on the way out.
 *
 * B★ B2 (2026-07-05) — the task-store CRUD + list + claim/complete/approve
 * family is now expressed as pure `coreFn(circle, args, ctx)` functions wrapped
 * by `wireSkill(coreFn, op, { storeFor })` from `@onderling/sdk`.  `wireSkill`
 * decodes `ctx.parts` → `args` (the same DataPart-unwrap the hand-written
 * `argsFromParts(parts)` did), validates `args` against the manifest op's
 * declared params, resolves the per-circle store via `storeFor(ctx)`, then calls
 * the core.  The wire behaviour is byte-identical: `storeFor` is exactly the
 * old `bundleResolver(parts, { envelope, from })` call, and each core keeps its
 * own `if (!circle) return { error: 'circleId required' }` guard (validation of the
 * op's declared params happens first, but every tested path supplies them).
 *
 * Skills that are NOT a clean `(circle, args, ctx)` task-store shape stay
 * hand-written `defineSkill`s below; each carries a note on why it wasn't
 * wired (no manifest op, a return-shaped error contract wireSkill would turn
 * into a throw, a resolver other than `bundleResolver`, or a manifest op whose
 * params intentionally diverge from the skill's real args).
 *
 * skill bodies resolve a per-circle CircleState via `bundleResolver`
 * at dispatch time. Single registration on the process-wide meshAgent.
 *
 * `from` carries the caller's identifier (the actor webid).  Skill
 * matching for skill-tagged tasks remains via L1e OfferingMatch.
 *
 * `resolveMember` lives in `@onderling/identity-resolver`'s
 * `buildIdentitySkills` and is registered alongside these by wireSkills.
 */

import { defineSkill } from '@onderling/core';
import { wireSkill } from '@onderling/sdk';
// Co-ownership (J2) — membership over the `assignees[]` set (falls back to the
// legacy `assignee` mirror for single-owner items) + the not-full claimable test.
import { assigneesOf, isAssigneesFull, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { computeStatus, effectiveStatus, unmetDeps, detectCycle } from '../dag.js';
import { argsFromParts } from '../bundleResolver.js';
// DESIGN gap #2 (2026-05-27) — `_sync` reply envelope for staleness hints.
import { simulateSync, decorateWithLastSync } from './_syncEnvelope.js';
import { validateCanonical } from '@onderling/item-types';
import { saveCircleConfig, loadCircleConfig, KIND_DEFAULTS } from '../Circle.js';
import { tasksManifest } from '../../manifest.js';
import {
  startPodSignIn      as _startPodSignIn,
  completePodSignIn   as _completePodSignIn,
  signOutOfPod        as _signOutOfPod,
  podSignInStatus     as _podSignInStatus,
} from '../lib/podSignIn.js';

/**
 * Cross-pod ref soft cap on `addTask({embeds: [...]})`. Eight keeps
 * the task panel readable while still allowing "this task touches
 * several other items" use cases. Tasks V2 substrate-adoption (the
 * A4 equivalent from Stoop V2 web). V2 functional design §4b.
 */
// Parameter register (#36) — cross-pod embed soft cap per task (scope:device, kind:internal).
const MAX_EMBEDS_PER_TASK = param({ key: 'tasksV0.maxEmbedsPerTask', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });

function _validateEmbed(e) {
  if (!e || typeof e !== 'object') return 'embed-not-object';
  if (typeof e.type !== 'string' || e.type.length === 0) return 'embed-type-missing';
  if (typeof e.ref  !== 'string' || e.ref.length  === 0) return 'embed-ref-missing';
  return null;
}

/**
 * Tasks V2 (2026-05-14) — circle storage policies (§II.2 of the
 * standardisation plan). Mirror of Stoop's A3 picker.
 */
const CIRCLE_STORAGE_POLICIES = ['no-pod', 'centralised', 'decentralised', 'hybrid'];

function _validateStoragePolicy(storagePolicy, groupPodUri) {
  if (typeof storagePolicy === 'undefined' || storagePolicy === null) return null;
  if (typeof storagePolicy !== 'string') return 'storage-policy-not-string';
  if (!CIRCLE_STORAGE_POLICIES.includes(storagePolicy)) return `storage-policy-unknown:${storagePolicy}`;
  if (storagePolicy === 'centralised' || storagePolicy === 'hybrid') {
    if (typeof groupPodUri !== 'string' || groupPodUri.length === 0) {
      return `storage-policy-needs-groupPodUri:${storagePolicy}`;
    }
  }
  return null;
}

function _buildStoragePolicy(storagePolicy, groupPodUri) {
  const policy = (typeof storagePolicy === 'string' && CIRCLE_STORAGE_POLICIES.includes(storagePolicy))
    ? storagePolicy
    : 'no-pod';
  if (policy === 'centralised' || policy === 'hybrid') {
    return { policy, groupPodUri };
  }
  return { policy };
}

// ── Pure cores: (circle, a, ctx) → result ──────────────────────────────────
//
// `circle`  the resolved CircleState (may be null when multi-circle routing misses —
//         each core guards with `if (!circle) return { error: 'circleId required' }`).
// `a`     the decoded args object (wireSkill's decodeArgs; identical to the old
//         `argsFromParts(parts)` for the single-DataPart wire convention).
// `ctx`   the full core skill context — `{ from, actorDisplayName, envelope, … }`.
//
// These are the byte-identical bodies of the former hand-written skills, with
// `argsFromParts(parts)` replaced by the injected `a`, `from`→`ctx.from`, and
// `actorDisplayName`→`ctx.actorDisplayName`.

/**
 * addTask({type='task', text, notes?, dependencies?, requiredSkills?,
 *         dueAt?, visibility?, embeds?})
 * Validates DAG cycle-free.  Returns the persisted task.
 *
 * Tasks V2 substrate-adoption (2026-05-14) — accepts `embeds: [{type,
 * ref}, ...]` for cross-pod refs (V2 web functional design §4b).
 */
async function addTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  // Phase 10 — block addTask when the circle is paused or archived.
  const lc = circle.liveCircle;
  if (lc?.archived) return { error: 'circle-archived' };
  if (lc?.paused)   return { error: 'circle-paused' };

  // Validate optional embeds (cross-pod refs).
  const inboundEmbeds = Array.isArray(a.embeds) ? a.embeds : [];
  if (inboundEmbeds.length > MAX_EMBEDS_PER_TASK) {
    return { error: `embeds-too-many:${inboundEmbeds.length}` };
  }
  const embeds = [];
  for (const e of inboundEmbeds) {
    const err = _validateEmbed(e);
    if (err) return { error: err };
    embeds.push({ type: e.type, ref: e.ref });
  }

  const partial = {
    type:           a.type ?? 'task',
    text:           a.text,
    ...(a.notes          !== undefined ? { notes:          a.notes }          : {}),
    ...(a.dependencies   !== undefined ? { dependencies:   a.dependencies }   : {}),
    ...(a.requiredSkills !== undefined ? { requiredSkills: a.requiredSkills } : {}),
    ...(a.dueAt          !== undefined ? { dueAt:          a.dueAt }          : {}),
    ...(a.visibility     !== undefined ? { visibility:     a.visibility }     : {}),
    // Phase 5 DoD-lifecycle fields (all optional; substrate honours them).
    ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
    ...(a.approval         !== undefined ? { approval:         a.approval         } : {}),
    ...(a.master           !== undefined ? { master:           a.master           } : {}),
    // Co-ownership (J2) — declare the claim ceiling at creation. Default 1 ⇒
    // exclusive first-come; >1 or null ⇒ co-ownable.
    ...(a.maxAssignees     !== undefined ? { maxAssignees:     a.maxAssignees     } : {}),
    // Claim confirmation MODE, declared at creation (the master's call): 'explicit' holds a claim pending
    // until an authority confirms it; absent/'auto' ⇒ the first claim confirms itself (the subtask fix).
    ...(a.claimConfirmation !== undefined ? { claimConfirmation: a.claimConfirmation } : {}),
    // Claim lease (§2.8), ms — an unfinished claim auto-releases after claimedAt+claimLease. Absent ⇒ manual.
    ...(a.claimLease !== undefined ? { claimLease: a.claimLease } : {}),
    // V2 task fields (auto-scheduling invoicing).
    ...(a.scheduledAt      !== undefined ? { scheduledAt:      a.scheduledAt     } : {}),
    ...(a.estimateMinutes  !== undefined ? { estimateMinutes:  a.estimateMinutes } : {}),
    // Tasks V2 standardisation adoption — cross-pod refs.
    ...(embeds.length > 0  ? { embeds } : {}),
  };
  // DAG cycle detection is now self-guarded inside the ported `addTasks`
  // (createTaskStore.addItems → detectCycle over the open set, throwing the
  // same `DEPENDENCY_CYCLE` code). The consumer-side re-check was removed in
  // the step-2 migration (2026-07-18) — the substrate owns the guard.
  const [task] = await circle.itemStore.addItems([partial], { actor: ctx.from, actorDisplayName: ctx.actorDisplayName });

  // Phase 52.7 — warn-only canonical-shape validation. Adoption is
  // observational at first: the substrate flags drift but never blocks
  // a write (existing data + forward-additive policy).
  try {
    const v = validateCanonical(task);
    if (!v.ok) console.warn('item-types[task]:', JSON.stringify(v.errors));
  } catch { /* validator outage must not break writes */ }

  // Phase 52.9.3 (Tasks V2 ninth slice, 2026-05-14) — substrate
  // fan-out. The mirror's publishTask helper handles the URI +
  // pseudoPod.write + notifyEnvelope.publish + recipient roster
  // all together; here we just kick it off.
  circle?.tasksMirror?.publishTask?.(task).catch(() => {});

  return { task };
}

/**
 * claimTask({id})
 * Compare-and-swap; loser gets `{error: 'already-claimed', current}`.
 */
async function claimTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  const result = await circle.itemStore.claim(a.id, { actor: ctx.from, actorDisplayName: ctx.actorDisplayName });
  // Phase 52.9.3 — publish the post-claim state. The
  // substrate is the source of authorisation truth on the
  // receiver side via applySync (gate-bypass); the receiver's
  // local item-store doesn't re-check the claim policy.
  if (result && !result.error) {
    circle?.tasksMirror?.publishTask?.(result).catch(() => {});
  }
  return { result };
}

/**
 * completeTask({id})
 */
async function completeTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  try {
    const [completed] = await circle.itemStore.markComplete(
      [{ id: a.id }],
      { actor: ctx.from, actorDisplayName: ctx.actorDisplayName },
    );
    // Phase 52.9.3 — fan-out the completion.
    if (completed) {
      circle?.tasksMirror?.publishTask?.(completed).catch(() => {});
      // "authority travels with the task" — the grant expires WITH the
      // task. Revoke every task-scoped grant materialized for this task so any
      // outstanding cap-token fails PolicyEngine.checkInbound. Best-effort:
      // completion already succeeded; a revoke hiccup must not undo it.
      try { circle?.taskGrantManager?.revokeTaskGrants?.(a.id); } catch { /* noop */ }
    }
    return { task: completed };
  } catch (err) {
    // translate the substrate's DependenciesOpenError into
    // a structured error the UI / bot can render usefully.
    if (err?.code === 'DEPENDENCIES_OPEN') {
      return { error: 'has-open-dependencies', openDeps: err.openDeps };
    }
    throw err;
  }
}

/**
 * removeTask({id})  — admin-only per role policy
 */
async function removeTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  // Capture the item's syncedFromId BEFORE removal (the
  // receiver-side mirror matches by the publishing device's id,
  // which may differ from `a.id` if THIS device is itself a
  // synced replica). We send the syncedFromId when present;
  // otherwise our local id is the canonical one.
  const localItem = (await circle.itemStore.listOpen()).find((i) => i.id === a.id)
                 ?? (await circle.itemStore.listClosed()).find((i) => i.id === a.id);
  const originalId = localItem?.source?.syncedFromId ?? a.id;
  const [id] = await circle.itemStore.removeItems([{ id: a.id }], { actor: ctx.from, actorDisplayName: ctx.actorDisplayName });
  // Phase 52.9.3 — fan-out the removal.
  circle?.tasksMirror?.publishTaskRemoved?.(originalId).catch(() => {});
  // cancelling/removing a task is a task-end too: revoke its grants so no
  // lingering authority survives the task (parity with completeTask).
  try { circle?.taskGrantManager?.revokeTaskGrants?.(a.id); } catch { /* noop */ }
  return { id };
}

/**
 * `getTaskSnapshot(id)` → ItemSnapshot — (basis v0.5)
 * snapshot factory.  Returns a thin display projection of the
 * task suitable for embedding in a chat message.  Read-only;
 * idempotent.
 */
async function getTaskSnapshotCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  if (!a.id) return { error: 'id required' };
  const open   = await circle.itemStore.listOpen({});
  const closed = await circle.itemStore.listClosed();
  const all    = [...open, ...closed];
  const target = all.find((t) => t.id === a.id);
  if (!target) return { error: `task "${a.id}" not found` };
  const status = effectiveStatus(target, open, closed);
  return {
    id:    target.id,
    type:  target.type ?? 'task',
    state: status,
    title: target.text ?? target.id,
    fields: {
      state:    status,
      assignee: target.assignee ?? 'unassigned',
      ...(target.requiredSkill ? { requires: target.requiredSkill } : {}),
    },
  };
}

/**
 * listOpen({type?, requiredSkill?, assignee?, status?})
 * Returns items + computed `status` (ready/waiting/blocked).
 */
async function listOpenCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  const filter = {};
  if (a.type)          filter.type          = a.type;
  if (a.requiredSkill) filter.requiredSkill = a.requiredSkill;
  if ('assignee' in a) filter.assignee      = a.assignee;
  const open   = await circle.itemStore.listOpen(filter);
  const closed = await circle.itemStore.listClosed();
  // 41.18 follow-up — every item carries:
  //   status   — lifecycle ∪ DAG (effectiveStatus)
  //   openDeps — unmet dependency IDs (unmetDeps); empty array
  //              when all deps satisfied. UI gates Mark-complete
  //              / Approve on `openDeps.length === 0` so a
  //              claimed-but-deps-blocked task pre-disables the
  //              CTA instead of waiting for the substrate's
  //              DependenciesOpenError post-tap (hard-deps).
  const items = open.map((t) => ({
    ...t,
    status:   effectiveStatus(t, open, closed),
    openDeps: unmetDeps(t, open, closed),
  }));
  const filtered = a.status ? items.filter((t) => t.status === a.status) : items;
  return { items: decorateWithLastSync(filtered), _sync: simulateSync() };
}

/**
 * listMine({})  — open tasks assigned to the calling actor.
 * Includes DAG `status` per item so 's open-deps gate
 * surfaces in the My-work UI (disabled "Mark complete" button).
 */
async function listMineCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  const open   = await circle.itemStore.listOpen();
  const closed = await circle.itemStore.listClosed();
  const items  = open
    .filter((t) => assigneesOf(t).includes(ctx.from))   // co-owner membership (mirror-compatible)
    .map((t) => ({
      ...t,
      status:   effectiveStatus(t, open, closed),
      openDeps: unmetDeps(t, open, closed),
    }));
  return { items: decorateWithLastSync(items), _sync: simulateSync() };
}

/**
 * listClaimable({skill?})  — unassigned tasks (optionally skill-filtered).
 */
async function listClaimableCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  // Co-ownership (J2): "claimable" = the co-owner set has ROOM (not full), which
  // for the default maxAssignees:1 is exactly "unassigned" (parity). A co-ownable
  // task stays claimable until its set fills. Filter in-core (the store's
  // `assignee:null` filter only understood the single-owner case).
  const filter = {};
  if (a.skill) filter.requiredSkill = a.skill;
  const open  = await circle.itemStore.listOpen(filter);
  const items = open.filter((t) => !isAssigneesFull(t));
  return { items: decorateWithLastSync(items), _sync: simulateSync() };
}

/**
 * submitTask({id, deliverable?, note?})
 *   claimed → submitted. Assignee submits with optional artifact
 *   reference. Substrate-side gating via `canSubmit`.
 */
async function submitTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  const updated = await circle.itemStore.submit(a.id, {
    ...(a.deliverable !== undefined ? { deliverable: a.deliverable } : {}),
    ...(a.note        !== undefined ? { note:        a.note        } : {}),
  }, { actor: ctx.from, actorDisplayName: ctx.actorDisplayName });
  // Phase 52.9.3 — fan-out the submission.
  if (updated) circle?.tasksMirror?.publishTask?.(updated).catch(() => {});
  return { task: updated };
}

/**
 * approveTask({id, note?})
 *   submitted → complete. Approver designated by item.approval.
 */
async function approveTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  try {
    const updated = await circle.itemStore.approve(a.id, {
      ...(a.note !== undefined ? { note: a.note } : {}),
    }, { actor: ctx.from, actorDisplayName: ctx.actorDisplayName });
    // Phase 52.9.3 — fan-out the approval.
    if (updated) circle?.tasksMirror?.publishTask?.(updated).catch(() => {});
    return { task: updated };
  } catch (err) {
    if (err?.code === 'DEPENDENCIES_OPEN') {
      return { error: 'has-open-dependencies', openDeps: err.openDeps };
    }
    throw err;
  }
}

/**
 * rejectTask({id, note})
 *   submitted → rejected → claimed. Note is mandatory.
 */
async function rejectTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  const updated = await circle.itemStore.reject(a.id, { note: a.note }, { actor: ctx.from, actorDisplayName: ctx.actorDisplayName });
  // Phase 52.9.3 — fan-out the rejection.
  if (updated) circle?.tasksMirror?.publishTask?.(updated).catch(() => {});
  return { task: updated };
}

/**
 * revokeTask({id, reason})
 *   claimed → open. Master / admin / coordinator only.
 *   Reason is mandatory; assignee gets it in the inbox + can appeal.
 */
async function revokeTaskCore(circle, a, ctx) {
  if (!circle) return { error: 'circleId required' };
  const updated = await circle.itemStore.revoke(a.id, { reason: a.reason }, { actor: ctx.from, actorDisplayName: ctx.actorDisplayName });
  // Phase 52.9.3 — fan-out the revocation.
  if (updated) circle?.tasksMirror?.publishTask?.(updated).catch(() => {});
  return { task: updated, previousAssignee: a.previousAssignee };
}

/**
 * B★ B2 (Workstream B) — the single source of truth for the wireable tasks
 * ops: opId → pure `(circle, args, ctx) → result` core.  BOTH projections read
 * from here:
 *   • the WIRE route — `buildSkills`'s `wire(id, …)` wraps `TASK_CORES[id]` with
 *     `wireSkill(core, op, { storeFor })` and registers it as a `defineSkill`.
 *   • the LOCAL route — `createTasksService().callSkill` calls `TASK_CORES[id]`
 *     directly (no synthetic `DataPart` round-trip).
 * The `local ≡ wire` fitness test (`test/localWireFitness.test.js`) asserts this
 * set stays in lock-step with the manifest ops + the wire registrations, so a
 * new op can never exist on one route but not the other (anti-drift invariant #3).
 */
export const TASK_CORES = Object.freeze({
  addTask:         addTaskCore,
  claimTask:       claimTaskCore,
  completeTask:    completeTaskCore,
  removeTask:      removeTaskCore,
  getTaskSnapshot: getTaskSnapshotCore,
  listOpen:        listOpenCore,
  listMine:        listMineCore,
  listClaimable:   listClaimableCore,
  submitTask:      submitTaskCore,
  approveTask:     approveTaskCore,
  rejectTask:      rejectTaskCore,
  revokeTask:      revokeTaskCore,
});

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @param {() => Iterable<object>} [args.circlesProvider]
 *   Optional. Used by **platform-level** skills (`provisionMyCircle`,
 *   `listSavedCircleConfigs`, `spawnMyCircle`) as a fallback when the
 *   regular routing-via-args.circleId resolution misses. Those skills
 *   write/read shared local-store state and don't care which circle
 *   they're "associated" with, so they pick the first available circle
 *   instead of returning a circleId-required error. Circle-strict skills
 *   (addTask, claimTask, etc.) still strict-null on miss.
 * @returns {Array<object>} array of `defineSkill` definitions
 */
/**
 * @param {object} [deps]
 * @param {Function} [deps.bundleResolver]
 * @param {Function} [deps.circlesProvider]
 * @param {(circleId: string, webid: string) => Promise<string|null>} [deps.circleRoleOf]
 *   The caller's role IN A CIRCLE, read from the host's membership head (the fold of the circle's
 *   signed statements). Injected because this app must not reach into the host's roster itself.
 *   Absent ⇒ the role half of an authority gate cannot be answered and the gate refuses; the
 *   creator path (below) still stands on its own.
 */
export function buildSkills({ bundleResolver, circlesProvider, circleRoleOf = null } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildSkills: bundleResolver(parts, ctx) required');
  }

  /**
   * Resolve a circle for a platform-level skill — try the strict
   * routing first, fall back to the first circle in `circlesProvider()`
   * when the lookup misses. Single-circle launches get the same
   * behaviour as before (`bundleResolver` returns the single circle
   * regardless of `args.circleId`).
   */
  function resolveAnyCircle(parts, ctx) {
    const direct = bundleResolver(parts, ctx);
    if (direct) return direct;
    if (typeof circlesProvider === 'function') {
      const iter = circlesProvider();
      if (iter && typeof iter[Symbol.iterator] === 'function') {
        const first = iter[Symbol.iterator]().next();
        if (!first.done && first.value) return first.value;
      }
    }
    return null;
  }

  // B★ B2 — `storeFor` is the exact old circle resolution: the same
  // `bundleResolver(parts, { envelope, from })` call every hand-written skill
  // made, lifted to operate on the wireSkill ctx.  `wire(id, coreFn, opts)`
  // looks the skill's op up in the tasks manifest, generates the
  // `defineSkill`-shaped handler with `wireSkill`, and re-attaches the same
  // description/visibility the hand-written skill declared.
  const storeFor = (ctx) => bundleResolver(ctx.parts, { envelope: ctx.envelope, from: ctx.from });
  const op = (id) => {
    const found = tasksManifest.operations.find((o) => o.id === id);
    if (!found) throw new Error(`buildSkills: no manifest op "${id}"`);
    return found;
  };
  const wire = (id, opts) => {
    const coreFn = TASK_CORES[id];
    if (!coreFn) throw new Error(`buildSkills: no core in TASK_CORES for "${id}"`);
    return defineSkill(id, wireSkill(coreFn, op(id), { storeFor }), opts);
  };

  return [
    // ── wireSkill-generated task-store CRUD + list + lifecycle family ──────
    wire('addTask', {
      description: 'Create a task; rejects on dependency cycles. Blocked when circle is paused/archived.',
      visibility:  'authenticated',
    }),

    wire('claimTask', {
      description: 'Compare-and-swap claim a task.',
      visibility:  'authenticated',
    }),

    wire('completeTask', {
      description: 'Mark a task complete.',
      visibility:  'authenticated',
    }),

    wire('removeTask', {
      description: 'Remove a task — admin only via item-store role policy.',
      visibility:  'authenticated',
    }),

    wire('getTaskSnapshot', {
      description: 'Snapshot a task for chat-embed (Q29 v0.5).',
      visibility:  'authenticated',
    }),

    wire('listOpen', {
      description: 'List open tasks with computed status; filters: type/requiredSkill/assignee/status.',
      visibility:  'authenticated',
    }),

    wire('listMine', {
      description: 'List open tasks assigned to the calling actor.',
      visibility:  'authenticated',
    }),

    wire('listClaimable', {
      description: 'List unassigned tasks; optional `skill` filter.',
      visibility:  'authenticated',
    }),

    // ── DoD-lifecycle skills (Tasks V1, Phase 5) ─────────────────────────
    wire('submitTask', {
      description: 'Submit a claimed task for approval.',
      visibility:  'authenticated',
    }),

    wire('approveTask', {
      description: 'Approve a submitted task.',
      visibility:  'authenticated',
    }),

    wire('rejectTask', {
      description: 'Reject a submitted task with a mandatory note.',
      visibility:  'authenticated',
    }),

    wire('revokeTask', {
      description: 'Revoke an assignment with a mandatory reason (master only).',
      visibility:  'authenticated',
    }),

    // ── Hand-written skills (NOT wired — see per-skill note) ───────────────

    /**
     * attachTaskGrant({taskId, member, grant}) — "authority travels with
     * the task" (NOTE-skills-vs-capabilities volley 5; journey J8).
     *
     * Attach ONE task-scoped, attenuated capability grant to `taskId` for
     * `member` (the grantee's pubKey). Delegates to the CircleState's
     * `TaskGrantManager.attachGrant`, which issues a real cap-token from the
     * agent's OWN identity — equal-or-narrower than what the granter holds
     * (attenuation enforced by the primitive) — stamped `constraints.task =
     * taskId` and tracked so completeTask/removeTask can revoke it.
     *
     * OFF BY DEFAULT: a task carries NO authority unless this op is called.
     * Only the task CREATOR or a circle ADMIN may attach (the same authority
     * that owns the task's lifecycle). Legibility: the granted tokenId is
     * recorded on the task's `source.taskGrants` via the existing update()
     * path — no bespoke whitelist field, so "this task may reach X" is visible.
     *
     * NOT wired: uses the `taskGrantManager` collaborator (not the item-store),
     * has a return-shaped error contract, and its args (`member`, `grant`)
     * diverge from the LLM-surface params — same reasons reassignTask/editTask
     * stay hand-written.
     */
    defineSkill('attachTaskGrant', async ({ parts, from, envelope, actorDisplayName }) => {
      // Error returns carry `ok:false` alongside `error` so the basis dispatch
      // waist (runDispatch's {ok:false,error} elevation guard) surfaces a FAILED
      // attach as an error bubble — not a misleading "done". Consumers still read
      // `.error` for the code (unchanged contract).
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { ok: false, error: 'circleId required' };
      const mgr = circle.taskGrantManager;
      if (!mgr) return { ok: false, error: 'task-grants-unavailable' };

      const a = argsFromParts(parts);
      const { taskId, member, grant } = a;
      if (typeof taskId !== 'string' || !taskId) return { ok: false, error: 'taskId required' };
      if (typeof member !== 'string' || !member) return { ok: false, error: 'member required' };
      if (!grant || typeof grant !== 'object' || Array.isArray(grant)) {
        return { ok: false, error: 'grant required' };
      }

      // Locate the task — it must exist AND it drives the creator gate.
      const open   = await circle.itemStore.listOpen();
      const closed = await circle.itemStore.listClosed();
      const task   = [...open, ...closed].find((t) => t.id === taskId);
      if (!task) return { ok: false, error: 'task-not-found' };

      // Gate: only the task's creator, or an ADMIN OF THE CIRCLE, may hand its authority to someone.
      //
      // The role comes from the host's membership head — the fold of the circle's signed statements
      // — not from this bundle's own member list. That list is composed locally and carries the
      // local device as admin, so reading it let any member attach a grant naming themselves: the
      // escalation the manifest entry for this op explicitly says the vocabulary exists to prevent.
      // Absence refuses; it never falls through to a yes.
      const isCreator = task.addedBy === from || task.master === from;
      if (!isCreator) {
        if (typeof circleRoleOf !== 'function') return { ok: false, error: 'authority-unavailable' };
        let role = null;
        try { role = await circleRoleOf(circle.circleId ?? circle.id ?? null, from); }
        catch { return { ok: false, error: 'authority-unavailable' }; }
        if (role !== 'admin') return { ok: false, error: 'permission-denied' };
      }

      // Issue the attenuated, task-scoped grant. Attenuation / off-by-default
      // are enforced by the primitive; a grant wider than the granter throws.
      let token;
      try {
        token = await mgr.attachGrant({ taskId, memberPubKey: member, grant });
      } catch (err) {
        return { ok: false, error: `grant-rejected:${err?.message ?? err}` };
      }

      // Legibility — record the granted tokenId on the task's `source` (merged,
      // never clobbering existing source fields). Best-effort: the grant is
      // already issued; a legibility-write hiccup must not fail the attach.
      let grants = null;
      try {
        const prevSource = (task.source && typeof task.source === 'object') ? task.source : {};
        const prevGrants = Array.isArray(prevSource.taskGrants) ? prevSource.taskGrants : [];
        grants = [...prevGrants, { tokenId: token.id, member, skill: token.skill }];
        const updated = await circle.itemStore.update(
          taskId,
          { source: { ...prevSource, taskGrants: grants } },
          { actor: from, actorDisplayName },
        );
        circle?.tasksMirror?.publishTask?.(updated).catch(() => {});
      } catch { /* legibility write is best-effort */ }

      return {
        ok:        true,
        taskId,
        member,
        tokenId:   token.id,
        skill:     token.skill,
        expiresAt: token.expiresAt,
        ...(grants ? { grants } : {}),
      };
    }, {
      description: 'Attach a task-scoped, attenuated capability grant to a task for a member (creator/admin only). Revoked when the task completes or is cancelled.',
      visibility:  'authenticated',
    }),

    /**
     * reassignTask({id, newAssignee})
     * Role-policy-gated (admin / coordinator only per buildStandardRolePolicy).
     * Gating is enforced inside ItemStore via the rolePolicy passed at construction.
     *
     * NOT wired: the manifest op declares `newAssignee` required, but this
     * skill intentionally supports the unassign path (`a.newAssignee ?? null`).
     * `wireSkill` would reject `reassignTask({id})` (unassign) as a missing
     * required param — a behaviour change. Kept hand-written.
     */
    defineSkill('reassignTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const updated = await circle.itemStore.reassign(a.id, a.newAssignee ?? null, { actor: from, actorDisplayName });
      // Phase 52.9.3 — fan-out the reassignment.
      if (updated) circle?.tasksMirror?.publishTask?.(updated).catch(() => {});
      return { task: updated };
    }, {
      description: 'Reassign a task — admin/coordinator only via item-store role policy.',
      visibility:  'authenticated',
    }),

    /**
     * listClaimConflicts — (task-claim-partition).
     *   Read the unresolved double-claim conflicts recorded on this
     *   circle's substrate mirror (a partition→merge that double-claimed
     *   a task surfaces here instead of silently last-writer-wins).
     *
     * NOT wired: reads the per-circle `tasksMirror` (a resolver other than
     * the item-store), so it has no `(circle,args,ctx)`-over-item-store core.
     */
    defineSkill('listClaimConflicts', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const conflicts = circle.tasksMirror?.listClaimConflicts?.() ?? [];
      return {
        conflicts: conflicts.map((c) => ({
          taskId:           c.taskId,
          text:             c.text ?? null,
          localAssignee:    c.localAssignee ?? null,
          incomingAssignee: c.incomingAssignee ?? null,
          at:               c.at ?? null,
        })),
      };
    }, {
      description: 'List unresolved double-claim conflicts for this circle.',
      visibility:  'authenticated',
    }),

    /**
     * resolveClaim({taskId, decision:'yours'|'theirs'|'both'}) —.
     *   Resolve a recorded claim-conflict. `yours` keeps the local
     *   claimant, `theirs` takes the incoming claimant, `both` keeps the
     *   local claimant AND mints a fresh task (distinct id) for the other
     *   claimant's product — mirrors `recipeConflict.applyResolution`'s
     *   'both' (keep local + add incoming under a fresh id). The
     *   resolution writes a causally-later claim (a reassign), which
     *   clears the conflict.
     *
     *   Gated by the existing reassign/revoke role policy
     *   (admin/coordinator). NOT wired: return-shaped error contract +
     *   `tasksMirror` resolver (same reason as editTask).
     */
    defineSkill('resolveClaim', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const taskId = a.taskId;
      const decision = a.decision;
      if (typeof taskId !== 'string' || !taskId) return { error: 'taskId required' };
      if (decision !== 'yours' && decision !== 'theirs' && decision !== 'both') {
        return { error: 'invalid-decision' };
      }
      const mirror = circle.tasksMirror;
      const conflict = mirror?.getClaimConflict?.(taskId);
      if (!conflict) return { error: 'no-conflict' };

      // Reuse the reassign/revoke gate: admin / coordinator resolve.
      const role = circle.liveCircle?.members?.find?.((m) => m.webid === from)?.role
        ?? circle?.roles?.[from] ?? null;
      if (role !== 'admin' && role !== 'coordinator') return { error: 'permission-denied' };

      const keepLocal = decision !== 'theirs';
      const winner = keepLocal ? conflict.localAssignee : conflict.incomingAssignee;

      // Causally-later claim (reassign) supersedes both concurrent claims and
      // clears the conflict state.
      const resolved = await circle.itemStore.reassign(taskId, winner, { actor: from, actorDisplayName });
      circle?.tasksMirror?.publishTask?.(resolved).catch(() => {});

      let alsoKept = null;
      if (decision === 'both') {
        const otherAssignee = conflict.incomingAssignee;
        const src = conflict.incoming ?? {};
        const draft = {
          type: 'task',
          text: conflict.text ?? src.text ?? '(resolved claim)',
          ...(src.notes ? { notes: src.notes } : {}),
          source: { claimConflictOrigin: taskId, resolvedFrom: 'both' },
        };
        const [minted] = await circle.itemStore.addItems([draft], { actor: from, actorDisplayName });
        const mintedClaimed = await circle.itemStore.reassign(minted.id, otherAssignee, { actor: from, actorDisplayName });
        circle?.tasksMirror?.publishTask?.(mintedClaimed).catch(() => {});
        alsoKept = { id: mintedClaimed.id, assignee: otherAssignee };
      }

      mirror.clearClaimConflict(taskId);
      return { resolved: { id: taskId, assignee: winner }, decision, ...(alsoKept ? { alsoKept } : {}) };
    }, {
      description: 'Resolve a claim-conflict (yours/theirs/both) — admin/coordinator only.',
      visibility:  'authenticated',
    }),

    /**
     * editTask({id, text?, notes?, dueAt?, requiredSkills?,
     *           dependencies?, scheduledAt?, estimateMinutes?,
     *           definitionOfDone?, visibility?})
     *   — 2026-05-24.  Patch body fields on an existing task.
     *
     *   Wraps itemStore.update which forbids editing attribution /
     *   completion / assignment fields (those have dedicated
     *   primitives — claim, submit, approve, …).  Caller can
     *   change any combination of the allowed fields in one call.
     *
     *   Re-validates the DAG when dependencies change so an edit
     *   can't introduce a cycle.  Blocked when the circle is paused
     *   or archived (same gate as addTask).
     *
     * NOT wired: this skill has a RETURN-shaped error contract
     * (`{error:'id required'}`, `{error:'no fields to update'}`,
     * `{error:'not-found'}`, `{error:'permission-denied'}`) that
     * `test/edit-task.test.js` pins as returned values. `wireSkill` would
     * turn the manifest's `id: required` into a THROW, breaking the
     * `{error:'id required'}` return. Kept hand-written.
     */
    defineSkill('editTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const lc = circle.liveCircle;
      if (lc?.archived) return { error: 'circle-archived' };
      if (lc?.paused)   return { error: 'circle-paused' };

      const a = argsFromParts(parts);
      if (typeof a.id !== 'string' || !a.id) return { error: 'id required' };

      // Only forward fields the caller actually supplied — undefined
      // would clobber existing values.
      const patch = {};
      for (const f of [
        'text', 'notes', 'dueAt', 'requiredSkills', 'dependencies',
        'scheduledAt', 'estimateMinutes', 'definitionOfDone', 'visibility',
      ]) {
        if (a[f] !== undefined) patch[f] = a[f];
      }
      if (Object.keys(patch).length === 0) return { error: 'no fields to update' };

      // DAG cycle re-check when dependencies change.
      if (Array.isArray(patch.dependencies) && patch.dependencies.length > 0) {
        const all = await circle.itemStore.listOpen();
        const cycle = detectCycle({ id: a.id, dependencies: patch.dependencies }, all);
        if (cycle) {
          throw Object.assign(
            new Error(`editTask: dependency cycle would form: ${cycle.join(' → ')}`),
            { code: 'DEPENDENCY_CYCLE', cycle },
          );
        }
      }

      try {
        const updated = await circle.itemStore.update(a.id, patch, { actor: from, actorDisplayName });
        // Re-publish through the substrate mirror so other circle
        // members see the update (same fan-out as addTask).
        circle?.tasksMirror?.publishTask?.(updated).catch(() => {});
        return { task: updated };
      } catch (err) {
        if (err?.code === 'ITEM_NOT_FOUND') return { error: 'not-found' };
        if (err?.code === 'PERMISSION_DENIED') return { error: 'permission-denied' };
        throw err;
      }
    }, {
      description: 'Patch body fields on an existing task (text, notes, dueAt, …); paused/archived circles blocked.',
      visibility:  'authenticated',
    }),

    /**
     * setApprovalMode({id, mode})
     *   Mutate the item's approval mode. App-level gating via canEditBody.
     *
     * NOT wired: no `operations[]` declaration in the manifest (it is a
     * mutate-in-place primitive, not a chat/slash-callable op), so there is
     * no op for `wireSkill` to derive from.
     */
    defineSkill('setApprovalMode', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const updated = await circle.itemStore.setApprovalMode(a.id, a.mode, { actor: from, actorDisplayName });
      return { task: updated };
    }, {
      description: 'Change the approval mode of an existing task.',
      visibility:  'authenticated',
    }),

    /**
     * getCircleStoragePolicy({circleId})
     *   — Tasks V2 standardisation adoption (2026-05-14). Returns the
     *   circle's storage policy `{policy, groupPodUri?}` from its
     *   `circleConfig.storage`. Defaults to `'no-pod'`.
     *
     * NOT wired: no `operations[]` declaration (pod-plumbing skill,
     * referenced only via a `pod-settings` dataSource.skillId).
     */
    defineSkill('getCircleStoragePolicy', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const storage = circle.liveCircle?.storage ?? { policy: 'no-pod' };
      return {
        policy:      storage.policy ?? 'no-pod',
        groupPodUri: storage.groupPodUri ?? null,
      };
    }, {
      description: "Tasks V2: read the circle's storage policy (§II.2: no-pod / centralised / decentralised / hybrid).",
      visibility:  'authenticated',
    }),

    /**
     * setCircleStoragePolicy({circleId, storagePolicy, groupPodUri?})
     *   — Tasks V2 standardisation adoption (2026-05-14). Admin /
     *   coordinator only. **One-way**: rejects downgrade to
     *   `'no-pod'` once a pod-having policy is active (substrate-
     *   side data migration is the user's job, per
     *   `Substrates/storage-migration-design-2026-05-14.md`).
     *
     * NOT wired: no `operations[]` declaration (pod-plumbing skill,
     * referenced only via `pod-settings` field.patch.opId).
     */
    defineSkill('setCircleStoragePolicy', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      // Admin / coordinator gate via the circle's role map.
      const role = circle.liveCircle?.members?.find?.((m) => m.webid === from)?.role
        ?? circle?.roles?.[from] ?? null;
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin-only' };
      }
      const err = _validateStoragePolicy(a.storagePolicy, a.groupPodUri);
      if (err) return { error: err };
      const next = _buildStoragePolicy(a.storagePolicy, a.groupPodUri);
      const current = circle.liveCircle?.storage ?? { policy: 'no-pod' };
      if (current.policy && current.policy !== 'no-pod' && next.policy === 'no-pod') {
        return { error: 'storage-policy-downgrade-not-supported' };
      }
      // Apply via the frozen-copy mutator (circleState.circleMutator).
      if (typeof circle.circleMutator === 'function') {
        circle.circleMutator({ storage: next });
      }
      return { circleId: circle.liveCircle?.circleId ?? a.circleId ?? null, storage: next };
    }, {
      description: 'Tasks V2: admin-only upgrade of the circle storage policy. One-way.',
      visibility:  'authenticated',
    }),

    /**
     * startPodSignIn({issuer, redirectUrl, circleId?})
     *   — Tasks V2 substrate-adoption (2026-05-14, Phase 52.15.3
     *   mirror). Kicks off the OIDC redirect dance. Returns the IdP
     *   authorize URL; the browser navigates there. The session is
     *   stored on `circle.oidcSession` until the callback lands.
     *
     * NOT wired: OIDC redirect orchestration, no `operations[]` op
     * (modelling it would need a redirect-flow primitive the substrate
     * doesn't yet have — manifest note at the `pod-settings` block).
     */
    defineSkill('startPodSignIn', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      return _startPodSignIn({ circle, issuer: a.issuer, redirectUrl: a.redirectUrl });
    }, {
      description: 'Phase 1 of pod sign-in: returns the IdP authorize URL.',
      visibility:  'authenticated',
    }),

    /**
     * completePodSignIn({callbackUrl, circleId?})
     *   — Tasks V2 substrate-adoption. Phase 2: handles the OIDC
     *   callback + attaches a SolidPodSource to the circle's
     *   CachingDataSource.
     *
     * NOT wired: OIDC orchestration, no `operations[]` op.
     */
    defineSkill('completePodSignIn', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      return _completePodSignIn({ circle, callbackUrl: a.callbackUrl });
    }, {
      description: 'Phase 2 of pod sign-in: completes the OIDC dance + attaches the pod-backed DataSource.',
      visibility:  'authenticated',
    }),

    /**
     * signOutOfPod({circleId?})
     *   — Tasks V2 substrate-adoption. Detaches the inner DataSource
     *   + clears the OIDC session. Local cache preserved.
     *
     * NOT wired: OIDC orchestration, no `operations[]` op.
     */
    defineSkill('signOutOfPod', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      return _signOutOfPod({ circle });
    }, {
      description: 'Sign out of the active pod; preserves local cache.',
      visibility:  'authenticated',
    }),

    /**
     * podSignInStatus({circleId?})
     *   — Tasks V2 substrate-adoption. Read-only `{signedIn, webid,
     *   podAttached}`.
     *
     * NOT wired: OIDC orchestration, no `operations[]` op.
     */
    defineSkill('podSignInStatus', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      return _podSignInStatus({ circle });
    }, {
      description: 'Read the current pod-sign-in state for this circle.',
      visibility:  'authenticated',
    }),

    /**
     * spawnMyCircle({circleId})
     *
     * Tasks V2 substrate-adoption (2026-05-14, sixth slice). Loads a
     * saved CircleConfig from the local store + (when the CLI is wired
     * for multi-circle runtime) brings up a fresh circle bundle on the
     * shared meshAgent + adds it to the runtime circlesMap.
     *
     * **In-process spawning** requires the host CLI to expose a
     * `_spawnCircleInProcess(circleId)` callback on the resolved circle's
     * `_circleState`. The `bin/tasks-ui.js` `--multi-circle` path wires
     * this; the default single-circle path does NOT.
     *
     * When the callback is missing (single-circle mode), the skill
     * returns a structured `{ok: true, ready: false, restartHint}`
     * payload so the UI can show the user the right CLI command to
     * restart with the new circle bound at boot.
     *
     * NOT wired: platform-level skill — resolves via `resolveAnyCircle`
     * (circlesProvider fallback), reads the shared `dataSource`, and has
     * no `operations[]` op with matching params.
     */
    defineSkill('spawnMyCircle', async ({ parts, from, envelope }) => {
      const circle = resolveAnyCircle(parts, { envelope, from });
      if (!circle?.dataSource?.read) return { error: 'no-data-source' };
      const a = argsFromParts(parts);
      if (typeof a.circleId !== 'string' || !a.circleId) {
        return { error: 'circleId required' };
      }
      if (a.circleId === circle?.liveCircle?.circleId) {
        return { error: 'circle-already-active' };
      }
      // Load the saved config to confirm it exists + is well-formed.
      // `loadCircleConfig` has a fallback for missing entries — we want a
      // strict "exists?" check here so the UI can surface "no such circle".
      const path = `mem://tasks/circles/${a.circleId}/config.json`;
      let cfg;
      try {
        const raw = await circle.dataSource.read(path);
        if (!raw) return { error: 'circle-not-found' };
        cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (err) {
        return { error: `load-failed:${err?.message ?? err}` };
      }
      if (!cfg || cfg.circleId !== a.circleId) {
        return { error: 'circle-not-found' };
      }

      // In-process spawn path (multi-circle runtime).
      if (typeof circle._spawnCircleInProcess === 'function') {
        try {
          const spawned = await circle._spawnCircleInProcess(a.circleId);
          return {
            ok:     true,
            ready:  true,
            circleId: spawned?.liveCircle?.circleId ?? a.circleId,
            name:   spawned?.liveCircle?.name ?? cfg.name,
            kind:   spawned?.liveCircle?.kind ?? cfg.kind,
          };
        } catch (err) {
          return { error: `spawn-failed:${err?.message ?? err}` };
        }
      }

      // Single-circle runtime: structured restart hint.
      return {
        ok:           true,
        ready:        false,
        circleId:       cfg.circleId,
        name:         cfg.name,
        kind:         cfg.kind,
        restartHint:  `Restart the tasks UI bound to "${cfg.circleId}". The single-circle CLI takes \`--circle=<path-to-config.json>\`; the saved config lives at \`mem://tasks/circles/${cfg.circleId}/config.json\` in the local-store. Multi-circle in-process runtime is a follow-up (see Project Files/Tasks App/v2-web-functional-design-2026-05-11.md §6a).`,
      };
    }, {
      description: 'Tasks V2: spawn a saved circle on the running agent (multi-circle runtime) OR return a restart hint when the CLI is single-circle mode.',
      visibility:  'authenticated',
    }),

    /**
     * listSavedCircleConfigs()
     *   — Tasks V2 substrate-adoption (2026-05-14). Scans the local
     *   store for `mem://tasks/circles/<circleId>/config.json` entries and
     *   returns the saved CircleConfigs. Includes a `running` flag per
     *   entry: `true` iff the active bundle is bound to that circleId.
     *   Used by `/circles.html` to surface saved-but-not-running circles
     *   so users can see what `provisionMyCircle` persisted before
     *   multi-circle runtime lands.
     *
     * NOT wired: platform-level skill — resolves via `resolveAnyCircle`,
     * reads the shared `dataSource`, and has no `operations[]` op.
     */
    defineSkill('listSavedCircleConfigs', async ({ parts, from, envelope }) => {
      const circle = resolveAnyCircle(parts, { envelope, from });
      if (!circle?.dataSource?.list) return { error: 'no-data-source' };
      let paths;
      try {
        paths = await circle.dataSource.list('mem://tasks/circles/');
      } catch (err) {
        return { error: `list-failed:${err?.message ?? err}` };
      }
      const configs = [];
      const runningId = circle?.liveCircle?.circleId ?? null;
      for (const path of paths ?? []) {
        if (!path.endsWith('/config.json')) continue;
        try {
          const raw = await circle.dataSource.read(path);
          if (!raw) continue;
          const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!cfg?.circleId) continue;
          configs.push({
            circleId:  cfg.circleId,
            name:    cfg.name ?? cfg.circleId,
            kind:    cfg.kind ?? 'household',
            storage: cfg.storage ?? { policy: 'no-pod' },
            members: Array.isArray(cfg.members)
              ? cfg.members.map(m => ({ webid: m.webid, displayName: m.displayName ?? null, role: m.role ?? 'member' }))
              : [],
            running: cfg.circleId === runningId,
          });
        } catch { /* skip malformed config */ }
      }
      configs.sort((a, b) => a.circleId.localeCompare(b.circleId));
      return { configs };
    }, {
      description: 'Tasks V2: list saved CircleConfigs in the local store with a running-flag per entry.',
      visibility:  'authenticated',
    }),

    /**
     * provisionMyCircle({circleId, name, kind, storagePolicy?, groupPodUri?,
     *                  displayName?, additionalMembers?})
     *
     * Tasks V2 standardisation adoption (2026-05-14). Persists a fresh
     * `CircleConfig` into the local-store at
     * `mem://tasks/circles/<circleId>/config.json` with the caller as
     * admin. Used by `/welcome.html`'s wizard for first-run
     * circle provisioning. The caller still needs to restart Tasks with
     * `--circle=...` (or supply the new circleId at boot) for the runtime
     * to actually bind to the new circle — this skill is the V2 design's
     * §4a "creator picks one of the four §II.2 policies" step, not the
     * full bundle bring-up.
     *
     * NOT wired: platform-level skill — resolves via `resolveAnyCircle`,
     * writes the shared `dataSource`, and its real args (`circleId`,
     * `storagePolicy`, `groupPodUri`, `displayName`, `additionalMembers`)
     * diverge from the manifest op's declared params (`name`, `kind`),
     * so `wireSkill`'s validation would not match the skill's contract.
     */
    defineSkill('provisionMyCircle', async ({ parts, from, envelope }) => {
      const circle = resolveAnyCircle(parts, { envelope, from });
      if (!circle?.dataSource?.write) return { error: 'no-data-source' };

      const a = argsFromParts(parts);
      if (typeof a.circleId !== 'string' || !/^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/.test(a.circleId)) {
        return { error: 'circleId-invalid' };
      }
      if (typeof a.name !== 'string' || a.name.length === 0) {
        return { error: 'name-required' };
      }
      const kind = (typeof a.kind === 'string' && KIND_DEFAULTS[a.kind]) ? a.kind : 'household';

      const storageErr = _validateStoragePolicy(a.storagePolicy, a.groupPodUri);
      if (storageErr) return { error: storageErr };
      const storage = _buildStoragePolicy(a.storagePolicy, a.groupPodUri);

      // Don't overwrite an existing circle with the same id (the wizard
      // surfaces a clear error to the user).
      const path = `mem://tasks/circles/${a.circleId}/config.json`;
      try {
        const existing = await circle.dataSource.read(path);
        if (existing) return { error: 'circleId-already-exists' };
      } catch { /* read-miss is the happy path */ }

      // Build the member list. Caller becomes admin; optional
      // `additionalMembers` lets the wizard seed admins + members.
      const seenWebids = new Set([from]);
      const members = [{
        webid:       from,
        displayName: typeof a.displayName === 'string' && a.displayName.length > 0
          ? a.displayName
          : null,
        role:        'admin',
      }];
      if (Array.isArray(a.additionalMembers)) {
        for (const m of a.additionalMembers) {
          if (!m || typeof m.webid !== 'string' || m.webid.length === 0) continue;
          if (seenWebids.has(m.webid)) continue;
          seenWebids.add(m.webid);
          members.push({
            webid:       m.webid,
            displayName: typeof m.displayName === 'string' ? m.displayName : null,
            role:        m.role === 'admin' || m.role === 'coordinator' || m.role === 'observer'
              ? m.role
              : 'member',
          });
        }
      }

      const saved = await saveCircleConfig({
        dataSource: circle.dataSource,
        config:     { circleId: a.circleId, name: a.name, kind, members, storage },
      });

      return {
        circleId:  saved.circleId,
        name:    saved.name,
        kind:    saved.kind,
        storage: saved.storage,
        members: saved.members,
      };
    }, {
      description: 'Tasks V2: provision a fresh circle config (caller becomes admin).',
      visibility:  'authenticated',
    }),
  ];
}
