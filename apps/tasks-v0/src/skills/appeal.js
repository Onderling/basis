/**
 * appealTask skill — Tasks V1 Phase 6.
 *
 * After a master revokes an assignment, the previous assignee can
 * `appealTask({taskId})` within 7 days to open a peer-to-peer chat
 * thread with the master. The thread is pre-loaded with the revoke
 * reason so the conversation starts with shared context.
 *
 * Substrate composition:
 *   - `@onderling/chat-p2p`'s `wireChat({...})` factory provides the
 *     `send(...)` controller. Tasks's Circle agent wires it once at
 *     boot; the appeal skill grabs the resulting controller and
 *     calls `send(...)` to deliver the opening message.
 *   - The thread id is `appeal:<taskId>` so the UI's per-task chat
 *     view can list appeal threads alongside the task.
 *
 * Skill arguments:
 *   - `taskId`      — required.
 *   - `body?`       — optional opening message; defaults to a polite
 *                     pre-fill that quotes the revoke reason.
 *
 * Authz:
 *   - Caller (`from`) must equal the `previousAssignee` recorded on
 *     the task's last `revoke` reviewLog entry.
 *   - The revoke must be ≤ 7 days old.
 *   - Substrate-side role-policy gate is intentionally NOT checked
 *     here — appeal is a self-service-by-the-revoked-assignee
 *     mechanism, not a role-gated operation.
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — post-revoke appeal window (scope:device, kind:internal).
const APPEAL_WINDOW_MS = param({ key: 'tasksV0.appealWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 7 * 24 * 60 * 60 * 1000 });

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildAppealSkill({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildAppealSkill: bundleResolver(parts, ctx) required');
  }
  return [
    defineSkill('appealTask', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.taskId !== 'string' || !a.taskId) {
        return { error: 'taskId required' };
      }
      if (typeof from !== 'string' || !from) {
        return { error: 'webid required (from envelope)' };
      }

      const item = await circle.itemStore.getById(a.taskId);
      if (!item) return { error: 'task not found', taskId: a.taskId };

      // Find the most recent `revoke` entry in the reviewLog.
      const lastRevoke = (item.reviewLog ?? [])
        .slice().reverse()
        .find((r) => r?.decision === 'revoke');
      if (!lastRevoke) {
        return { error: 'task has not been revoked', taskId: a.taskId };
      }

      // Look up the previousAssignee from the audit log (revoke audit
      // records it in `details.previousAssignee`). Fall back to the
      // item's current assignee == null + caller-was-recently-claimed
      // heuristic only if the audit log is missing — in V1 the audit
      // log is the source of truth.
      const audit = await circle.itemStore.auditLog({ itemId: a.taskId, action: 'revoke' });
      const lastRevokeAudit = audit[audit.length - 1];
      const previousAssignee = lastRevokeAudit?.details?.previousAssignee ?? null;

      if (previousAssignee !== from) {
        return {
          error:   'only the previous assignee may appeal',
          taskId:  a.taskId,
        };
      }

      const ageMs = Date.now() - (lastRevoke.at ?? 0);
      if (ageMs > APPEAL_WINDOW_MS) {
        return {
          error:           'appeal window expired',
          taskId:          a.taskId,
          revokedAt:       lastRevoke.at,
          appealWindowMs:  APPEAL_WINDOW_MS,
        };
      }

      const chatController = circle.chatController;
      if (!chatController?.send) {
        return {
          error:  'chat-not-wired',
          taskId: a.taskId,
          info:   'circle has no @onderling/chat-p2p controller; appeal needs a peer chat substrate',
        };
      }

      const master = item.master ?? item.addedBy;
      if (typeof master !== 'string' || !master) {
        return { error: 'task has no master; cannot route appeal' };
      }

      const threadId = `appeal:${a.taskId}`;
      const body = typeof a.body === 'string' && a.body.trim().length > 0
        ? a.body
        : `Hi — I'd like to discuss the revoke on "${item.text}". Reason given: "${lastRevoke.note ?? '(no reason)'}".`;

      await chatController.send({
        toWebid:  master,
        threadId,
        body,
      });

      return {
        ok:       true,
        threadId,
        taskId:   a.taskId,
        master,
      };
    }, {
      description: 'Open a chat thread with the master to appeal a revoke (within 7 days).',
      visibility:  'authenticated',
    }),
  ];
}

export { APPEAL_WINDOW_MS };
