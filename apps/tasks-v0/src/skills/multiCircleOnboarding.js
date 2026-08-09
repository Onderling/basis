/**
 * multiCircleOnboarding — Tasks V2 multi-circle runtime (2026-05-14).
 *
 * `buildOnboardingSkills` in `@onderling/identity-resolver` is per-
 * circle: its closure captures `groupManager`, `members`, `groupId`,
 * `onSpawn` once. Registering it from `createCircleAgent` for each
 * circle would silently last-write-wins the global skill registry,
 * dropping all but the latest circle's GroupManager.
 *
 * This wrapper registers `issueInvite` + `redeemInvite` ONCE against
 * the meshAgent. Each call resolves the right CircleState from
 * `bundleResolver` and reads the per-circle GroupManager + MemberMap
 * + onSpawn hook that `createCircleAgent` stashed on it.
 *
 * Wire it from `bin/tasks-ui.js --multi-circle` AFTER `wireSkills` so
 * the rest of the skill surface is already registered.
 */

import { defineSkill } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — invite default TTL (scope:device, kind:internal).
const DEFAULT_TTL_MS = param({ key: 'tasksV0.ttlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 * 60 * 1000 });

function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolves a CircleState from skill args. The CircleState must expose
 *   `groupManager`, `members`, and `circleIdForOnboarding` (set in
 *   `createCircleAgent` when the circle is built — including the
 *   multi-circle `wireOnboardingSkills: false` path).
 * @returns {Array<object>}
 */
export function buildMultiCircleOnboardingSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildMultiCircleOnboardingSkills: bundleResolver required');
  }

  return [
    /**
     * issueInvite({circleId, ttlMs?, role?}) → {invite}
     *
     * Multi-circle variant: `circleId` is mandatory for routing. The
     * resolved CircleState supplies the per-circle GroupManager.
     */
    defineSkill('issueInvite', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle?.groupManager) return { error: 'circleId required' };
      const a = dataArgs(parts);
      const ttlMs = Number.isFinite(a.ttlMs) ? a.ttlMs : DEFAULT_TTL_MS;
      const role  = a.role ?? 'member';
      const groupId = circle.circleIdForOnboarding ?? circle.liveCircle?.circleId ?? circle.circleId;
      const invite = await circle.groupManager.issueInvite(groupId, { expiresIn: ttlMs, role });
      return { invite };
    }, {
      description: 'Multi-circle: issue a single-use invite for the routed circle (admin-only).',
      visibility:  'authenticated',
    }),

    /**
     * redeemInvite({invite, displayName?, webid?, memberPubKey?})
     *   → {groupProof, memberPubKey, webid, displayName, members,
     *      spawnedUrl?}
     *
     * Multi-circle variant: the invite carries the groupId; we look
     * the matching CircleState up via that. The routing arg `circleId`
     * is OPTIONAL — when omitted, we infer it from `invite.groupId`.
     */
    defineSkill('redeemInvite', async ({ parts, from, envelope }) => {
      const a = dataArgs(parts);
      if (!a.invite) return { error: 'invite required' };

      // Routing: caller may pass `circleId`; otherwise infer from the
      // invite payload. The resolver runs in two passes if the
      // caller didn't supply one — first with what they passed, then
      // (when that fails) with the invite's groupId.
      let circle = bundleResolver(parts, { envelope, from });
      if (!circle?.groupManager) {
        const groupIdFromInvite = a.invite?.groupId ?? null;
        if (groupIdFromInvite) {
          // Synthesize parts with the inferred circleId so the
          // bundleResolver picks the right CircleState.
          const synthParts = [
            { type: 'DataPart', data: { ...a, circleId: groupIdFromInvite } },
          ];
          circle = bundleResolver(synthParts, { envelope, from });
        }
      }
      if (!circle?.groupManager) return { error: 'circleId required (no matching circle)' };

      if (!(await circle.groupManager.verifyInvite(a.invite))) {
        return { error: 'invalid or expired invite' };
      }

      const role        = a.invite.role ?? 'member';
      const webid       = a.webid       ?? null;
      const displayName = a.displayName ?? webid?.split('/').pop() ?? null;

      let memberPubKey = a.memberPubKey ?? null;
      let spawnedUrl;

      const onSpawn = circle.onSpawn ?? null;
      if (onSpawn) {
        let spawn;
        try {
          spawn = await onSpawn({
            webid:       webid ?? `urn:onboard:${Math.random().toString(36).slice(2, 10)}`,
            displayName: displayName ?? 'New member',
            role,
          });
        } catch (err) {
          return { error: `spawn failed: ${err?.message ?? err}` };
        }
        memberPubKey = spawn.identity.pubKey;
        spawnedUrl   = spawn.spawnedUrl;
      } else if (!memberPubKey) {
        return { error: 'memberPubKey required (no spawn hook configured)' };
      }

      let proof;
      try {
        proof = await circle.groupManager.redeemInvite(a.invite, memberPubKey);
      } catch (err) {
        return { error: err?.message ?? 'redemption failed' };
      }

      const finalWebid       = webid       ?? `urn:pubkey:${memberPubKey}`;
      const finalDisplayName = displayName ?? finalWebid.split(':').pop().slice(0, 12);

      await circle.members.addMember({
        webid:       finalWebid,
        displayName: finalDisplayName,
        role:        proof.role,
        pubKey:      memberPubKey,
      });

      // Phase 52.9.3 (2026-05-14) — live peer-roster
      // update. Tell the substrate-mirror about the new peer so the
      // next addTask fan-out reaches them. Best-effort (the local
      // member-map update above is the source of truth; the mirror
      // roster is a downstream cache for fan-out routing).
      if (typeof circle.tasksMirror?.addPeer === 'function') {
        try { await circle.tasksMirror.addPeer(memberPubKey); } catch { /* swallow */ }
      }

      const allMembers = await circle.members.list();
      return {
        groupProof: proof,
        memberPubKey,
        webid:       finalWebid,
        displayName: finalDisplayName,
        members:     allMembers,
        ...(spawnedUrl ? { spawnedUrl } : {}),
      };
    }, {
      description: 'Multi-circle: redeem an invite — routes by args.circleId or invite.groupId.',
      visibility:  'public',
    }),
  ];
}
