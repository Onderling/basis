/**
 * onboardingSkills — invite-link → group-token onboarding skills.
 *
 * **2026-05-08:** lifted from `apps/stoop/src/onboarding.js`
 * (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 * Stoop's `onboarding.js` is now a thin wrapper.
 *
 * Two skills + the spawn-on-redemption hook. Designed to work both
 * in-process (testbed: admin + N members in one process; the
 * `onSpawn` hook brings the new member's runtime online inline) and
 * out-of-process (production: each member runs their own agent;
 * `redeemInvite` only mints the proof, the calling process imports
 * it).
 *
 * The redemption flow:
 *   1. Admin's UI calls `issueInvite({ttlMs?, role?})` → invite token.
 *   2. Admin shares the invite link out-of-band.
 *   3. New member opens it, redeems via `redeemInvite({invite, ...})`.
 *   4. Skill validates the invite, optionally spawns the member's
 *      runtime (testbed), mints + returns the GroupProof, persists
 *      the member into the MemberMap.
 *
 * The skill names (`issueInvite`, `redeemInvite`) and signatures are
 * preserved verbatim from Stoop's V1 Phase 7 — apps that already
 * register these names continue to work after the lift.
 */
import { defineSkill, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — onboarding-skill registration TTL (scope:device, kind:internal).
const DEFAULT_TTL_MS = param({ key: 'onboardingSkills.ttlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 * 60 * 1000 });        // 1 hour

/**
 * @typedef {(args: {webid, displayName, role}) => Promise<{
 *   identity:     import('@onderling/core').AgentIdentity,
 *   spawnedUrl?:  string,
 * }>} OnSpawnHook
 *
 * The hook is called by `redeemInvite` BEFORE the proof is minted.
 * It must generate (or restore) the new member's identity and bring
 * up whatever runtime state belongs in the spawn (testbed: a new
 * core.Agent + its UI; production: just generate-and-return the
 * identity).
 */

/**
 * Build the onboarding skills.
 *
 * @param {object} args
 * @param {import('@onderling/core').GroupManager} args.groupManager
 * @param {import('./MemberMap.js').MemberMap} args.members
 * @param {string} args.groupId
 * @param {OnSpawnHook} [args.onSpawn]   optional spawn-and-mint-identity hook (testbed)
 * @returns {Array<object>}              array of `defineSkill` definitions
 */
export function buildOnboardingSkills({ groupManager, members, groupId, onSpawn }) {
  if (!groupManager) throw new TypeError('buildOnboardingSkills: groupManager required');
  if (!members)      throw new TypeError('buildOnboardingSkills: members (MemberMap) required');
  if (typeof groupId !== 'string' || !groupId) {
    throw new TypeError('buildOnboardingSkills: groupId required');
  }

  return [
    /**
     * issueInvite({ttlMs?, role?}) → {invite}
     * Admin-only via the LocalUiAuth-configured actor; the role-policy
     * gate above us is at the item-store layer, not here.
     */
    defineSkill('issueInvite', async ({ parts }) => {
      const a = dataArgs(parts);
      const ttlMs = Number.isFinite(a.ttlMs) ? a.ttlMs : DEFAULT_TTL_MS;
      const role  = a.role ?? 'member';
      const invite = await groupManager.issueInvite(groupId, { expiresIn: ttlMs, role });
      return { invite };
    }, {
      description: 'Issue a single-use group invite token (admin-only).',
      visibility:  'authenticated',
    }),

    /**
     * redeemInvite({invite, displayName?, webid?, memberPubKey?})
     *   → {groupProof, memberPubKey, webid, displayName, members, spawnedUrl?}
     *
     * Two flows:
     *  - **Testbed/in-process** (when an `onSpawn` hook is wired): the
     *    skill generates a fresh AgentIdentity via the hook, redeems the
     *    invite for that pubKey, spawns the new member's runtime in the
     *    same process, returns its `spawnedUrl`. The browser doesn't
     *    need to do any crypto.
     *  - **Production** (no hook, separate-process member): the new
     *    member's process generates its own identity beforehand and
     *    passes `memberPubKey` in. The skill mints + returns the proof;
     *    the calling process imports it.
     */
    defineSkill('redeemInvite', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!a.invite) return { error: 'invite required' };

      if (!(await groupManager.verifyInvite(a.invite))) {
        return { error: 'invalid or expired invite' };
      }

      const role        = a.invite.role ?? 'member';
      const webid       = a.webid       ?? null;
      const displayName = a.displayName ?? webid?.split('/').pop() ?? null;

      let memberPubKey = a.memberPubKey ?? null;
      let spawnedUrl;

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
        proof = await groupManager.redeemInvite(a.invite, memberPubKey);
      } catch (err) {
        return { error: err?.message ?? 'redemption failed' };
      }

      const finalWebid       = webid       ?? `urn:pubkey:${memberPubKey}`;
      const finalDisplayName = displayName ?? finalWebid.split(':').pop().slice(0, 12);

      await members.addMember({
        webid:       finalWebid,
        displayName: finalDisplayName,
        role:        proof.role,
        pubKey:      memberPubKey,
      });

      const allMembers = await members.list();
      return {
        groupProof: proof,
        memberPubKey,
        webid:       finalWebid,
        displayName: finalDisplayName,
        members:     allMembers,
        ...(spawnedUrl ? { spawnedUrl } : {}),
      };
    }, {
      description: 'Redeem an invite for a new member; mints + persists a GroupProof.',
      visibility:  'public',
    }),
  ];
}

function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}
