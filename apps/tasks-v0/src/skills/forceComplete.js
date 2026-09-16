/**
 * forceComplete —.
 *
 * Admin-only override for `completeTask` when a parent has open
 * dependencies. Mandatory `reason` is recorded in the audit log
 * under a distinct `force-complete` action so the override is
 * visible to anyone reading the parent's history.
 *
 * Sub-tasks stay open (no cascade) — closing the parent is the
 * single-purpose effect of this skill. If the admin wants to remove
 * the sub-tasks too, they call `removeTask` separately.
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { makeRoleOf } from './roleOf.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildForceCompleteSkill({ bundleResolver, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildForceCompleteSkill: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('forceCompleteTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      if (typeof a.id !== 'string' || !a.id.trim()) {
        return { error: 'id required' };
      }
      if (typeof a.reason !== 'string' || !a.reason.trim()) {
        return { error: 'reason required (mandatory for force-complete; recorded in the audit log)' };
      }
      try {
        const [completed] = await circle.itemStore.markComplete(
          [{ id: a.id }],
          {
            actor:            from,
            actorDisplayName,
            actionOverride:   'force-complete',
            reason:           a.reason.trim(),
          },
        );
        return { ok: true, task: completed, reason: a.reason.trim() };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }, {
      description: 'Admin-only force-close override (bypasses the dependency gate; mandatory reason).',
      visibility:  'authenticated',
    }),
  ];
}
