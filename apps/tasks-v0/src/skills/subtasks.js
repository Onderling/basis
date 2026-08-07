/**
 * subtasks — Tasks V1 Phase 7.
 *
 * Three skills:
 *
 *   1. `addSubtask({parentTaskId, ...partial})` — claimer-of-parent
 *      OR parent's master OR admin/coord can spawn. Computes the
 *      sub-task's depth via `parentTaskId` walk; if depth >
 *      `circleConfig.subtasksAdminApprovalDepth` (default 3),
 *      INSTEAD of creating the sub-task immediately, files a
 *      `type: 'subtask-request'` item in the same item-store and
 *      returns `{queued: true, requestId}`. Circle admins receive
 *      an inbox notification (wired separately).
 *
 *   2. `approveSubtaskRequest({requestId})` — admin / coordinator
 *      only. Reads the queued request and creates the actual
 *      sub-task using its stored partial. Marks the request
 *      complete (clears it from the queue).
 *
 *   3. `declineSubtaskRequest({requestId, note?})` — admin /
 *      coordinator only. Marks the request complete with a decline
 *      note. The spawner gets an inbox entry via the existing
 *      `wireIssuerNotifications` (item-completed listener).
 *
 * Design notes:
 *
 *   - Master of a spawned sub-task = the spawner (NOT the parent's
 *     master). The parent's master keeps oversight via the dep edge
 *     — they can `revoke` the parent (which cascades a prompt to the
 *     spawner) and they can see the entire sub-task tree, but day-
 *     to-day ownership of grandchildren rests with the spawner.
 *   - Parent's `dependencies` is updated in-place to include the
 *     new sub-task's id (so `computeStatus` correctly reports the
 *     parent as `waiting` until all sub-tasks complete).
 *   - Cycle detection: rejected before write via `wouldCreateParentCycle`.
 */

import { defineSkill } from '@onderling/core';

import { depthOf, wouldCreateParentCycle } from '../dag-tree.js';
import { argsFromParts } from '../bundleResolver.js';

const REQUEST_TYPE = 'subtask-request';
const PROPOSAL_TYPE = 'subtask-proposal';
const DEFAULT_ADMIN_APPROVAL_DEPTH = 3;

/**
 * Build the sub-task skills.
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildSubtaskSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildSubtaskSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('addSubtask', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.parentTaskId !== 'string' || !a.parentTaskId) {
        return { error: 'parentTaskId required' };
      }
      if (typeof a.text !== 'string' || !a.text.trim()) {
        return { error: 'text required' };
      }
      if (typeof from !== 'string' || !from) {
        return { error: 'webid required (from envelope)' };
      }

      const itemStore = circle.itemStore;
      const parent = await itemStore.getById(a.parentTaskId);
      if (!parent) return { error: 'parent task not found', parentTaskId: a.parentTaskId };
      if (parent.completedAt) {
        return { error: 'parent task is already complete' };
      }

      // Authz: caller must be parent's assignee OR master OR admin/coord.
      const role = circle.roles?.[from];
      const isAdminish = role === 'admin' || role === 'coordinator';
      const allowed =
        isAdminish ||
        parent.assignee === from ||
        (parent.master ?? parent.addedBy) === from;
      if (!allowed) {
        return {
          error: 'only the parent\'s assignee, master, or an admin/coordinator may spawn sub-tasks',
        };
      }

      // when parent has an open submission, addSubtask is
      // blocked. Caller must use proposeSubtask, which goes through
      // assignee approval. Self-spawn (assignee adding to their own
      // task) is allowed — the assignee can amend their own scope.
      if (_hasOpenSubmission(parent) && parent.assignee !== from) {
        return {
          error:            'parent-submitted',
          proposalRequired: true,
          parentTaskId:     a.parentTaskId,
          assignee:         parent.assignee,
        };
      }

      const lc = circle.liveCircle ?? {};
      const threshold = Number.isFinite(lc?.subtasksAdminApprovalDepth)
        ? lc.subtasksAdminApprovalDepth
        : DEFAULT_ADMIN_APPROVAL_DEPTH;

      // The child fields (the spawn verb owns creation + containment + the parent's `dependencies` gate).
      const childArgs = {
        type:           a.type ?? 'task',
        text:           a.text,
        master:         a.master ?? from,    // spawner is master by default
        ...(a.notes            !== undefined ? { notes:            a.notes }            : {}),
        ...(a.requiredSkills   !== undefined ? { requiredSkills:   a.requiredSkills }   : {}),
        ...(a.dueAt            !== undefined ? { dueAt:            a.dueAt }            : {}),
        ...(a.visibility       !== undefined ? { visibility:       a.visibility }       : {}),
        ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
        ...(a.approval         !== undefined ? { approval:         a.approval }         : {}),
      };

      // Spawn through the CONTAINMENT verb — it establishes `containedBy` + the parent `dependencies` gate +
      // the depth-approval hold, GATED on the actor holding a CONFIRMED claim on the parent (or master/admin,
      // via the store's rolePolicy). A pending (unconfirmed) claim no longer unlocks the subtree.
      let spawnRes;
      try {
        spawnRes = await itemStore.spawnSubtask(a.parentTaskId, childArgs, {
          actor: from, actorDisplayName, approvalDepth: threshold,
        });
      } catch (e) {
        if (e && (e.code === 'PERMISSION_DENIED' || e.name === 'PermissionDeniedError')) {
          return { error: 'only the parent\'s confirmed claimant, master, or an admin/coordinator may spawn sub-tasks' };
        }
        throw e;
      }

      if (spawnRes.queued) {
        // Past the approval depth — the verb HELD it; file the admin-approval request (its workflow item).
        const partial = { ...childArgs, parentTaskId: a.parentTaskId };
        const [request] = await itemStore.addItems([{
          type:    REQUEST_TYPE,
          text:    `Sub-task request: "${a.text}" under "${parent.text}"`,
          source: {
            kind:           'subtask-request',
            parentTaskId:   a.parentTaskId,
            requestedBy:    from,
            requestedDepth: spawnRes.depth,
            partial,
          },
          master: from,
        }], { actor: from, actorDisplayName });
        return { queued: true, requestId: request.id, newDepth: spawnRes.depth, threshold };
      }

      // The child carries the CONTAINMENT edge (`containedBy`). A PENDING claimant gets a PROVISIONAL child
      // (optimistic, "not yours yet", doesn't gate the parent — §2.5); a confirmed claimant/master a committed
      // one. `parentTaskId` is deliberately never set.
      return {
        queued:      false,
        provisional: spawnRes.provisional ?? false,
        task:        spawnRes.task,
        depth:       spawnRes.depth,
      };
    }, {
      description: 'Spawn a sub-task. Past the circle\'s admin-approval depth, files a request instead.',
      visibility:  'authenticated',
    }),

    defineSkill('approveSubtaskRequest', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const role = circle.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      if (typeof a.requestId !== 'string' || !a.requestId) {
        return { error: 'requestId required' };
      }
      const itemStore = circle.itemStore;
      const req = await itemStore.getById(a.requestId);
      if (!req) return { error: 'request not found', requestId: a.requestId };
      if (req.type !== REQUEST_TYPE) {
        return { error: 'item is not a subtask-request', requestId: a.requestId };
      }
      if (req.completedAt) {
        return { error: 'request already resolved' };
      }
      const partial = req.source?.partial;
      if (!partial || typeof partial !== 'object') {
        return { error: 'request has no partial; cannot create sub-task' };
      }
      const parent = await itemStore.getById(partial.parentTaskId);
      if (!parent) {
        return { error: 'parent task no longer exists; decline this request instead' };
      }

      // Create the sub-task on behalf of the original requester (preserving `addedBy`), then establish the
      // CONTAINMENT edge — this flow is already authorised (admin approved the depth request), so it nests
      // directly rather than through the confirmed-claim spawn gate. `parentTaskId` is dropped.
      const { parentTaskId: _pid, ...childPartial } = partial;
      const [sub] = await itemStore.addItems([childPartial], { actor: req.source.requestedBy });
      const { child: contained } = await itemStore.contain(parent.id, sub.id, { actor: from });

      // Wire the parent's dependencies + close the request.
      const parentDeps = Array.isArray(parent.dependencies) ? parent.dependencies : [];
      if (!parentDeps.includes(sub.id)) {
        await itemStore.update(parent.id, {
          dependencies: [...parentDeps, sub.id],
        }, { actor: from, actorDisplayName });
      }
      await itemStore.markComplete([{ id: req.id }], { actor: from, actorDisplayName });

      return { ok: true, task: contained, requestId: req.id };
    }, {
      description: 'Approve a queued sub-task request (admin/coordinator only).',
      visibility:  'authenticated',
    }),

    defineSkill('declineSubtaskRequest', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const role = circle.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      if (typeof a.requestId !== 'string' || !a.requestId) {
        return { error: 'requestId required' };
      }
      const itemStore = circle.itemStore;
      const req = await itemStore.getById(a.requestId);
      if (!req) return { error: 'request not found', requestId: a.requestId };
      if (req.type !== REQUEST_TYPE) {
        return { error: 'item is not a subtask-request', requestId: a.requestId };
      }
      if (req.completedAt) return { error: 'request already resolved' };

      // Update notes (visible in audit log) then mark the request
      // complete. The spawner sees a "task completed" inbox entry
      // via the existing wireIssuerNotifications listener.
      await itemStore.update(req.id, {
        notes: a.note ? `Declined: ${a.note}` : 'Declined',
      }, { actor: from, actorDisplayName });
      await itemStore.markComplete([{ id: req.id }], { actor: from, actorDisplayName });

      return { ok: true, requestId: req.id };
    }, {
      description: 'Decline a queued sub-task request (admin/coordinator only).',
      visibility:  'authenticated',
    }),

    /**
     * propose a sub-task on a `submitted` parent. Files a
     * `subtask-proposal` queue item targeting the parent's assignee.
     * The assignee approves or declines via the two skills below.
     *
     * Authz: master / coord / admin (same set as addSubtask, since
     * this is the after-submit equivalent).
     */
    defineSkill('proposeSubtask', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.parentTaskId !== 'string' || !a.parentTaskId) {
        return { error: 'parentTaskId required' };
      }
      if (typeof a.text !== 'string' || !a.text.trim()) {
        return { error: 'text required' };
      }
      const itemStore = circle.itemStore;
      const parent = await itemStore.getById(a.parentTaskId);
      if (!parent) return { error: 'parent task not found', parentTaskId: a.parentTaskId };
      if (parent.completedAt) return { error: 'parent task is already complete' };
      if (!_hasOpenSubmission(parent)) {
        return { error: 'parent is not in submitted state — use addSubtask directly' };
      }
      if (!parent.assignee) {
        return { error: 'parent has no assignee — propose-flow needs someone to consent' };
      }
      const role = circle.roles?.[from];
      const isAdminish = role === 'admin' || role === 'coordinator';
      const isMaster   = (parent.master ?? parent.addedBy) === from;
      if (!isAdminish && !isMaster) {
        return { error: 'master, coordinator, or admin required for proposeSubtask' };
      }

      const partial = {
        type:           a.type ?? 'task',
        text:           a.text,
        parentTaskId:   a.parentTaskId,
        master:         a.master ?? from,
        ...(a.notes            !== undefined ? { notes:            a.notes }            : {}),
        ...(a.requiredSkills   !== undefined ? { requiredSkills:   a.requiredSkills }   : {}),
        ...(a.dueAt            !== undefined ? { dueAt:            a.dueAt }            : {}),
        ...(a.visibility       !== undefined ? { visibility:       a.visibility }       : {}),
        ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
        ...(a.approval         !== undefined ? { approval:         a.approval }         : {}),
      };

      const [proposal] = await itemStore.addItems([{
        type:    PROPOSAL_TYPE,
        text:    `Sub-task proposal: "${a.text}" under "${parent.text}"`,
        source: {
          kind:           'subtask-proposal',
          parentTaskId:   a.parentTaskId,
          requestedBy:    from,
          targetAssignee: parent.assignee,
          partial,
        },
        master: from,
      }], { actor: from, actorDisplayName });

      return {
        queued:     true,
        proposalId: proposal.id,
        assignee:   parent.assignee,
      };
    }, {
      description: 'Propose a sub-task on a submitted parent — assignee must consent.',
      visibility:  'authenticated',
    }),

    /**
     * assignee approves the proposal. Spawns the sub-task,
     * walks the parent submitted → claimed via the existing reject
     * primitive (preserves the original `submit` entry in the
     * reviewLog as history).
     */
    defineSkill('approveSubtaskProposal', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.proposalId !== 'string' || !a.proposalId) {
        return { error: 'proposalId required' };
      }
      const itemStore = circle.itemStore;
      const prop = await itemStore.getById(a.proposalId);
      if (!prop) return { error: 'proposal not found', proposalId: a.proposalId };
      if (prop.type !== PROPOSAL_TYPE) {
        return { error: 'item is not a subtask-proposal', proposalId: a.proposalId };
      }
      if (prop.completedAt) return { error: 'proposal already resolved' };

      const targetAssignee = prop.source?.targetAssignee;
      if (from !== targetAssignee) {
        return { error: 'only the parent\'s assignee can approve this proposal' };
      }

      const partial = prop.source?.partial;
      if (!partial || typeof partial !== 'object') {
        return { error: 'proposal has no stored partial — cannot spawn' };
      }
      const parentId = partial.parentTaskId;
      const parent = await itemStore.getById(parentId);
      if (!parent) {
        return { error: 'parent task no longer exists; decline this proposal instead' };
      }

      // Spawn the sub-task on behalf of the original proposer (preserving `addedBy`), then nest via containment
      // (the assignee consented — already authorised). `parentTaskId` is dropped.
      const { parentTaskId: _pid2, ...childPartial } = partial;
      const [subCreated] = await itemStore.addItems(
        [childPartial],
        { actor: prop.source.requestedBy, actorDisplayName },
      );
      const { child: sub } = await itemStore.contain(parent.id, subCreated.id, { actor: from });

      // Wire parent.dependencies to include the new child id.
      const parentDeps = Array.isArray(parent.dependencies) ? parent.dependencies : [];
      if (!parentDeps.includes(sub.id)) {
        await itemStore.update(parent.id, {
          dependencies: [...parentDeps, sub.id],
        }, { actor: from, actorDisplayName });
      }

      // Walk parent submitted → claimed via the reject primitive.
      try {
        await itemStore.reject(parent.id, {
          note: `auto-rollback: scope changed via subtask proposal ${prop.id}`,
        }, { actor: prop.source.requestedBy, actorDisplayName: `${from} (assignee approved)` });
      } catch {
        // If the parent isn't actually in submitted state any more
        // (race), continue — the new sub-task still got created.
      }

      // Mark the proposal complete.
      await itemStore.markComplete([{ id: prop.id }], { actor: from, actorDisplayName });

      return { ok: true, task: sub, proposalId: prop.id, parentRolledBack: true };
    }, {
      description: 'Assignee approves a subtask-proposal; spawns subtask + rolls parent submitted→claimed.',
      visibility:  'authenticated',
    }),

    defineSkill('declineSubtaskProposal', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.proposalId !== 'string' || !a.proposalId) {
        return { error: 'proposalId required' };
      }
      const itemStore = circle.itemStore;
      const prop = await itemStore.getById(a.proposalId);
      if (!prop) return { error: 'proposal not found', proposalId: a.proposalId };
      if (prop.type !== PROPOSAL_TYPE) {
        return { error: 'item is not a subtask-proposal', proposalId: a.proposalId };
      }
      if (prop.completedAt) return { error: 'proposal already resolved' };
      const targetAssignee = prop.source?.targetAssignee;
      if (from !== targetAssignee) {
        return { error: 'only the parent\'s assignee can decline this proposal' };
      }

      await itemStore.update(prop.id, {
        notes: a.note ? `Declined: ${a.note}` : 'Declined',
      }, { actor: from, actorDisplayName });
      await itemStore.markComplete([{ id: prop.id }], { actor: from, actorDisplayName });

      return { ok: true, proposalId: prop.id };
    }, {
      description: 'Assignee declines a subtask-proposal; parent submission stays valid.',
      visibility:  'authenticated',
    }),

    /**
     * admin override: bypass both the post-submit gate AND
     * the admin-approval-depth threshold. Mandatory `reason` lands
     * in the audit log under a distinct `force-spawn` action label
     * so the override is auditable.
     */
    defineSkill('forceSpawnSubtask', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = circle.roles?.[from];
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      if (typeof a.parentTaskId !== 'string' || !a.parentTaskId) {
        return { error: 'parentTaskId required' };
      }
      if (typeof a.text !== 'string' || !a.text.trim()) {
        return { error: 'text required' };
      }
      if (typeof a.reason !== 'string' || !a.reason.trim()) {
        return { error: 'reason required (mandatory; recorded in the audit log)' };
      }
      const itemStore = circle.itemStore;
      const parent = await itemStore.getById(a.parentTaskId);
      if (!parent) return { error: 'parent task not found', parentTaskId: a.parentTaskId };
      if (parent.completedAt) return { error: 'parent task is already complete' };

      const childPartial = {
        type:           a.type ?? 'task',
        text:           a.text,
        master:         a.master ?? from,
        ...(a.notes            !== undefined ? { notes:            a.notes }            : {}),
        ...(a.requiredSkills   !== undefined ? { requiredSkills:   a.requiredSkills }   : {}),
        ...(a.dueAt            !== undefined ? { dueAt:            a.dueAt }            : {}),
        ...(a.visibility       !== undefined ? { visibility:       a.visibility }       : {}),
        ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
        ...(a.approval         !== undefined ? { approval:         a.approval }         : {}),
      };

      // Admin override — create the child (auditable `force-spawn`), then nest via containment. `parentTaskId`
      // is dropped; the admin's authority carries the create, no confirmed-claim gate.
      const [subCreated] = await itemStore.addItems([childPartial], {
        actor:            from,
        actorDisplayName,
        actionOverride:   'force-spawn',
        reason:           a.reason.trim(),
      });
      const { child: sub } = await itemStore.contain(parent.id, subCreated.id, { actor: from });

      const parentDeps = Array.isArray(parent.dependencies) ? parent.dependencies : [];
      if (!parentDeps.includes(sub.id)) {
        await itemStore.update(parent.id, {
          dependencies: [...parentDeps, sub.id],
        }, { actor: from, actorDisplayName });
      }

      return { ok: true, task: sub, reason: a.reason.trim() };
    }, {
      description: 'Admin-only force-spawn override (bypasses post-submit gate + approval-depth; mandatory reason).',
      visibility:  'authenticated',
    }),

    /**
     * Confirm a pending claim — the authority (task master, or admin/coordinator via the rolePolicy) turns a
     * PENDING claim into the real, subtree-unlocking one. Only needed for EXPLICIT-confirm tasks; a default
     * (auto-confirm) task confirms on `claimTask` already. `assignee` names the claim to confirm (defaults to
     * the current sole claimant).
     */
    defineSkill('confirmClaim', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.id !== 'string' || !a.id) {
        return { error: 'id required (the task whose claim to confirm)' };
      }
      const res = await circle.itemStore.confirmClaim(a.id, {
        actor: from, assignee: a.assignee, actorDisplayName,
      });
      if (!res || res.error) return res ?? { error: 'confirm failed' };
      // Publish the confirmed state to peers (parity with claimTask's mirror publish).
      circle?.tasksMirror?.publishTask?.(res)?.catch?.(() => {});
      return { ok: true, task: res };
    }, {
      description: 'Confirm a pending claim (task master / admin) so the claimant may decompose the subtree.',
      visibility:  'authenticated',
    }),
  ];
}

/**
 * true iff the task's reviewLog has a `submit` entry without
 * a subsequent `approve` or `reject`. I.e. parent is currently in
 * the "submitted" state.
 */
function _hasOpenSubmission(task) {
  const log = Array.isArray(task?.reviewLog) ? task.reviewLog : [];
  let lastSubmit = -1;
  let lastVerdict = -1;
  for (let i = 0; i < log.length; i++) {
    const d = log[i]?.decision;
    if (d === 'submit') lastSubmit = i;
    if (d === 'approve' || d === 'reject') lastVerdict = i;
  }
  return lastSubmit > lastVerdict;
}

export { REQUEST_TYPE, DEFAULT_ADMIN_APPROVAL_DEPTH, PROPOSAL_TYPE };
