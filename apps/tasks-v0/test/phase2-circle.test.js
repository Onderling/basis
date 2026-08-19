/**
 * Phase 2 — Circle envelope tests.
 *
 * Covers:
 *   1. CircleConfig load / save round-trip via a CachingDataSource.
 *   2. Missing-config fallback (returns implicit-household defaults).
 *   3. createCircleAgent zero-config = V0 implicit-household path
 *      (still works when nothing is supplied).
 *   4. createCircleAgent with a localStoreBundle wires MemberMapCache
 *      so member additions auto-persist to the bundle's cache.
 *   5. Onboarding skills (`issueInvite`, `redeemInvite`) get
 *      registered when wireOnboardingSkills is on (default).
 *   6. wireOnboardingSkills:false skips skill registration.
 *   7. Per-kind defaults (subtasksAdminApprovalDepth) applied.
 */

import { describe, it, expect } from 'vitest';

import { DataPart } from '@onderling/core';

import {
  IMPLICIT_HOUSEHOLD_CONFIG as _IMPLICIT,
  KIND_DEFAULTS,
  loadCircleConfig,
  saveCircleConfig,
  createCircleAgent,
} from '../src/Circle.js';
import { buildBundle } from '../src/storage/buildBundle.js';

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CAROL = 'https://id.example/carol';

const SAMPLE_CONFIG = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    { webid: BOB,  displayName: 'Bob',  role: 'member' },
  ],
};

describe('Phase 2 — Circle envelope', () => {
  describe('config loader', () => {
    it('round-trips a config through saveCircleConfig + loadCircleConfig', async () => {
      const bundle = buildBundle();
      await saveCircleConfig({ dataSource: bundle.cache, config: SAMPLE_CONFIG });

      const loaded = await loadCircleConfig({
        dataSource: bundle.cache,
        circleId:     'oss-tools',
      });
      expect(loaded.circleId).toBe('oss-tools');
      expect(loaded.name).toBe('OSS Tools NL');
      expect(loaded.kind).toBe('project');
      expect(loaded.members).toHaveLength(2);
      expect(loaded.members[0].webid).toBe(ANNE);
      // Per-kind default applied (project = 4)
      expect(loaded.subtasksAdminApprovalDepth).toBe(4);
    });

    it('falls back to implicit-household defaults when no config blob exists', async () => {
      const bundle = buildBundle();
      const loaded = await loadCircleConfig({
        dataSource: bundle.cache,
        circleId:     'fresh-circle',
      });
      expect(loaded.circleId).toBe('fresh-circle');
      expect(loaded.kind).toBe('household');
      expect(loaded.members).toEqual([]);
      expect(loaded.subtasksAdminApprovalDepth).toBe(3);
    });

    it('uses the explicit fallback when supplied + no blob present', async () => {
      const bundle = buildBundle();
      const loaded = await loadCircleConfig({
        dataSource: bundle.cache,
        circleId:     'maintenance-circle',
        fallback:   { circleId: 'maintenance-circle', name: 'Community garden', kind: 'maintenance' },
      });
      expect(loaded.kind).toBe('maintenance');
      expect(loaded.name).toBe('Community garden');
    });

    it('rejects bad inputs', async () => {
      await expect(loadCircleConfig({})).rejects.toThrow(/dataSource/);
      const bundle = buildBundle();
      await expect(loadCircleConfig({ dataSource: bundle.cache })).rejects.toThrow(/circleId/);
    });
  });

  describe('per-kind defaults', () => {
    it('applies the right depth threshold per kind', () => {
      expect(KIND_DEFAULTS.household.subtasksAdminApprovalDepth).toBe(3);
      expect(KIND_DEFAULTS.project.subtasksAdminApprovalDepth).toBe(4);
      expect(KIND_DEFAULTS.friends.subtasksAdminApprovalDepth).toBe(2);
    });
  });

  describe('createCircleAgent — zero-config implicit household', () => {
    it('boots with no circleConfig + no localStoreBundle (V0 parity)', async () => {
      const result = await createCircleAgent({
        wireOnboardingSkills: false,  // skip per-circle skill registration
      });
      expect(result.agent).toBeDefined();
      expect(result.itemStore).toBeDefined();
      expect(result.circle.circleId).toBe('household');
      expect(result.circle.kind).toBe('household');
      expect(result.localStore).toBeNull();
      // Contract update 2026-05-14 (Tasks V2 seventh slice): the
      // GroupManager is always constructed + stashed on CircleState
      // for multi-circle dispatch. `wireOnboardingSkills:false` only
      // skips per-circle skill registration.
      expect(result.groupManager).toBeTruthy();
    });
  });

  describe('createCircleAgent — with localStoreBundle', () => {
    it('uses the bundle cache for the ItemStore AND wires MemberMapCache for the roster', async () => {
      const lsBundle = buildBundle();

      const result = await createCircleAgent({
        circleConfig:           SAMPLE_CONFIG,
        localStoreBundle:     lsBundle,
        wireOnboardingSkills: false,
      });

      expect(result.localStore).toBe(lsBundle);
      expect(result.circle.circleId).toBe('oss-tools');
      expect(result.memberMapCacheDetach).toBeTypeOf('function');

      // Add a member to the live MemberMap; expect it to appear in the
      // cache under the per-circle rootContainer.
      await result.members.addMember({ webid: CAROL, displayName: 'Carol', role: 'member' });

      // Give the cache write a microtask to flush.
      await new Promise((r) => setTimeout(r, 20));

      const keys = await lsBundle.cache.list('mem://tasks/circles/oss-tools/members/');
      expect(keys.length).toBeGreaterThan(0);
      const persisted = await Promise.all(keys.map((k) => lsBundle.cache.read(k)));
      const flat = persisted.map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
      const carol = flat.find((m) => m?.webid === CAROL);
      expect(carol).toBeTruthy();
      expect(carol.displayName).toBe('Carol');
    });
  });

  describe('createCircleAgent — onboarding skills', () => {
    it('registers issueInvite + redeemInvite when wireOnboardingSkills is on (default)', async () => {
      const result = await createCircleAgent({
        circleConfig: { ...SAMPLE_CONFIG },
      });

      expect(result.groupManager).toBeDefined();
      expect(result.agent.skills.has('issueInvite')).toBe(true);
      expect(result.agent.skills.has('redeemInvite')).toBe(true);

      // Smoke-test: actually issue an invite and verify it carries the right groupId.
      const inviteRes = await callSkill(result.agent, 'issueInvite', { ttlMs: 60_000, role: 'member' }, ANNE);
      expect(inviteRes.invite).toBeTruthy();
      expect(inviteRes.invite.groupId).toBe('oss-tools');
    });

    it('skips skill registration when wireOnboardingSkills:false (but still builds GroupManager for multi-circle dispatch)', async () => {
      // Contract update 2026-05-14 (Tasks V2 seventh slice): the
      // GroupManager is always constructed + stashed on the CircleState
      // so the multi-circle onboarding wrapper can find it per call.
      // Only the per-circle skill registration is skipped — the CLI's
      // --multi-circle path registers the wrapper once instead.
      const result = await createCircleAgent({
        circleConfig:           SAMPLE_CONFIG,
        wireOnboardingSkills: false,
      });
      expect(result.groupManager).toBeTruthy();
      expect(result._circleState.groupManager).toBe(result.groupManager);
      expect(result.agent.skills.has('issueInvite')).toBe(false);
      expect(result.agent.skills.has('redeemInvite')).toBe(false);
    });
  });
});
