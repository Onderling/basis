/**
 * customRoles — custom-role management.
 *
 * Tasks ships the standard 5 roles only (Q-H4.7 (a) baseline).
 * unblocks the (c) extension path — apps register additional
 * roles per-circle via:
 *
 *   - `registerCircleCustomRole({roleId, rank})` — admin only.
 *     Validates against `core.Roles.registerCustomRole` (which
 *     enforces uniqueness on roleId + rank); persists into
 *     `liveCircle.customRoles` so the role survives a process
 *     restart that re-runs the boot-time wiring.
 *
 *   - `unregisterCircleCustomRole({roleId})` — admin only. Mirrors.
 *
 *   - `listKnownRoles()` — read-only union of standard + custom
 *     roles. UI uses it to populate the "set role" dropdown when
 *     editing membership / promoting members.
 *
 * **Note on process-global state.** The underlying
 * `core.Roles.customRanks` map is process-wide (one CLI = one
 * registry). After 's single-agent refactor, multi-circle
 * launches share the same `core.Roles` registry, so apps using
 * multiple circles in the same process MUST coordinate roleId
 * namespaces to avoid collisions.
 */

import {
  defineSkill,
  registerCustomRole, unregisterCustomRole, listKnownRoles,
  isKnownRole, isStandardRole,
} from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { makeRoleOf } from './roleOf.js';

/**
 * Re-register every custom role from a CircleConfig. Idempotent:
 * `registerCustomRole` throws on collision, but the typical caller
 * is boot-time wiring after a fresh start — so duplicates are not
 * expected. Apps that re-run this in the same process catch and
 * skip already-registered ids.
 *
 * @param {Array<{id: string, rank: number}>} customRoles
 * @returns {{registered: string[], skipped: string[]}}
 */
export function applyCustomRoles(customRoles) {
  const registered = [];
  const skipped = [];
  for (const r of customRoles ?? []) {
    if (!r?.id || !Number.isFinite(r?.rank)) continue;
    if (isKnownRole(r.id)) {
      skipped.push(r.id);
      continue;
    }
    try {
      registerCustomRole(r.id, r.rank);
      registered.push(r.id);
    } catch {
      skipped.push(r.id);
    }
  }
  return { registered, skipped };
}

/**
 * Build the custom-role skills.
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildCustomRoleSkills({ bundleResolver, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildCustomRoleSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('listKnownRoles', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const lc = circle.liveCircle ?? {};
      const customs = (lc.customRoles ?? []).map((r) => ({ id: r.id, rank: r.rank, source: 'circle' }));
      // listKnownRoles from core returns ids only; merge ranks from
      // the standard table + the circle's own customRoles.
      const standard = ['admin', 'coordinator', 'member', 'observer', 'external'].map((id) => ({
        id,
        rank: { admin: 100, coordinator: 80, member: 60, observer: 40, external: 20 }[id],
        source: 'standard',
      }));
      // Include any custom roles already in the process registry that
      // aren't in this circle's config (rare; surfaces bootstrap drift).
      const known = listKnownRoles();
      const extras = known
        .filter((id) => !isStandardRole(id))
        .filter((id) => !customs.some((r) => r.id === id))
        .map((id) => ({ id, rank: undefined, source: 'process' }));
      return { roles: [...standard, ...customs, ...extras] };
    }, {
      description: 'List standard + custom roles known to this circle.',
    }),

    defineSkill('registerCircleCustomRole', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      const id = typeof a.roleId === 'string' ? a.roleId.trim() : '';
      const rank = a.rank;
      if (!id) return { error: 'roleId required' };
      if (!Number.isFinite(rank) || rank <= 0) return { error: 'rank (positive number) required' };
      if (isStandardRole(id)) return { error: `roleId "${id}" collides with a standard role` };

      // Process-level registration. Idempotent if the same circle already
      // had this id; surface the validation error otherwise.
      try {
        if (!isKnownRole(id)) registerCustomRole(id, rank);
      } catch (err) {
        return { error: String(err?.message ?? err) };
      }

      // Persist into the live circle config.
      const lc = circle.liveCircle ?? {};
      const existing = Array.isArray(lc.customRoles) ? lc.customRoles : [];
      const without = existing.filter((r) => r?.id !== id);
      circle.circleMutator({ customRoles: [...without, { id, rank }] });

      return { ok: true, role: { id, rank } };
    }, {
      description: 'Register a new custom role for this circle (admin only).',
    }),

    defineSkill('unregisterCircleCustomRole', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      const id = typeof a.roleId === 'string' ? a.roleId.trim() : '';
      if (!id) return { error: 'roleId required' };
      if (isStandardRole(id)) return { error: `cannot unregister standard role "${id}"` };

      // Remove from the process registry. If it isn't there, no-op.
      try {
        unregisterCustomRole(id);
      } catch {
        // Standard-role guard above already covered the throwy path;
        // any remaining error means it wasn't registered. Continue
        // so we still update the circle config below.
      }

      const lc = circle.liveCircle ?? {};
      const existing = Array.isArray(lc.customRoles) ? lc.customRoles : [];
      circle.circleMutator({ customRoles: existing.filter((r) => r?.id !== id) });

      return { ok: true, removed: id };
    }, {
      description: 'Remove a custom role from this circle (admin only).',
    }),
  ];
}
