/**
 * buildIdentitySkills — pre-built skill definitions over a MemberMap.
 *
 * Returns an array of `defineSkill(...)` objects ready to register on a
 * `core.Agent`:
 *
 *   import { Agent } from '@onderling/core';
 *   import { MemberMap, buildIdentitySkills } from '@onderling/identity-resolver';
 *
 *   const agent = await Agent.createNew({ transport, label: 'X' });
 *   for (const def of buildIdentitySkills({ members })) agent.register(def);
 *
 * Skills returned:
 *
 *   resolveMember — DataPart in: {webid} or {externalIdNs, externalIdValue}
 *                   DataPart out: {member}
 *
 * Lifted from the duplicate copies in apps/tasks-v0 and
 * apps/neighbourhood-v0 (rule-of-two). Migrated 2026-05-04 from the
 * legacy `(args, ctx) => result` shape to `defineSkill` shape as part
 * of L1d Phase 3.1 (substrate-vs-SDK refactor).
 */

import { defineSkill } from '@onderling/core';

/**
 * Read a single DataPart's `data` from a Parts[] input. Defaults to `{}`.
 * @param {Array<object>} parts
 * @returns {object}
 */
function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * @param {object} args
 * @param {import('./MemberMap.js').MemberMap | null | undefined} args.members
 * @returns {Array<object>} array of `defineSkill` definitions
 */
export function buildIdentitySkills({ members, getBundle }) {
  // Single-agent refactor (2026-05-08): when `getBundle` is supplied,
  // resolve the per-group MemberMap at dispatch time. Falls back to
  // the closure-bound `members` for back-compat (single-bundle apps).
  const _resolveMembers = (args, ctx) => {
    if (typeof getBundle === 'function') {
      const b = getBundle(args, ctx);
      return b?.members ?? null;
    }
    return members ?? null;
  };

  return [
    defineSkill('resolveMember', async ({ parts, from, envelope }) => {
      const a = dataArgs(parts);
      const m = _resolveMembers(a, { envelope, from });
      if (!m) {
        // Strict reject when getBundle returns null — group not found.
        return typeof getBundle === 'function'
          ? { error: 'groupId required' }
          : { member: null };
      }
      if (a.webid) {
        return { member: await m.resolveByWebid(a.webid) };
      }
      if (a.externalIdNs && a.externalIdValue) {
        return {
          member: await m.resolveByExternalId(a.externalIdNs, a.externalIdValue),
        };
      }
      return { member: null };
    }, {
      description: 'Resolve a member record by webid or external id (e.g. telegram uid).',
      visibility:  'authenticated',
    }),
  ];
}
