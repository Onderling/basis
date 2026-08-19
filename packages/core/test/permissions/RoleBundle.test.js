/**
 * RoleBundle + RoleGrant — roles as capability bundles, materialized on grant.
 *
 * Covers the artifact end-to-end:
 *   1. the bundle SHAPE + registry (validate against Roles.js, built-in admin);
 *   2. grantRole MATERIALIZES the bundle — sets the governance role via
 *      GroupManager AND issues the bundle's cap-tokens to the member;
 *   3. enforcement stays PolicyEngine — a bundle-granted role satisfies a
 *      `requiredRole` gate; a materialized token verifies through checkInbound;
 *   4. revoke → the materialized tokens no longer verify (revocation hook).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  ROLES, roleRank, isKnownRole, listKnownRoles, isStandardRole,
  unregisterCustomRole,
} from '../../src/permissions/Roles.js';
import {
  defineRoleBundle, registerRoleBundle, getRoleBundle, hasRoleBundle,
  listRoleBundles, resetRoleBundles, ADMIN_ROLE_BUNDLE,
} from '../../src/permissions/RoleBundle.js';
import { RoleGrantManager, materializeBundle } from '../../src/permissions/RoleGrant.js';
import { GroupManager }    from '../../src/permissions/GroupManager.js';
import { CapabilityToken } from '../../src/permissions/CapabilityToken.js';
import { PolicyEngine, PolicyDeniedError } from '../../src/permissions/PolicyEngine.js';
import { TrustRegistry }   from '../../src/permissions/TrustRegistry.js';
import { SkillRegistry }   from '../../src/skills/SkillRegistry.js';
import { defineSkill }     from '../../src/skills/defineSkill.js';
import { AgentIdentity }   from '../../src/identity/AgentIdentity.js';
import { VaultMemory }     from '@onderling/vault';

/** Clear any test-registered custom roles + reset the bundle registry. */
function cleanRegistries() {
  for (const r of listKnownRoles()) {
    if (!isStandardRole(r)) { try { unregisterCustomRole(r); } catch { /* ignore */ } }
  }
  resetRoleBundles();
}

beforeEach(cleanRegistries);

// ── The bundle object + registry ─────────────────────────────────────────────

describe('RoleBundle — shape + registry', () => {
  it('the built-in admin bundle is "can manage this circle" (circle.* grant)', () => {
    expect(ADMIN_ROLE_BUNDLE.id).toBe(ROLES.ADMIN);
    expect(ADMIN_ROLE_BUNDLE.rank).toBe(roleRank('admin'));      // 100 — no hand-copied number
    expect(ADMIN_ROLE_BUNDLE.grants).toEqual([{ skill: 'circle.*' }]);
    // Registered by default (seeded at module load / resetRoleBundles).
    expect(getRoleBundle('admin')).toEqual(ADMIN_ROLE_BUNDLE);
    expect(hasRoleBundle('admin')).toBe(true);
  });

  it('defineRoleBundle over a STANDARD role keeps its Roles.js rank', () => {
    const b = defineRoleBundle({ id: 'coordinator', grants: [{ skill: 'tasks.*' }] });
    expect(b.rank).toBe(roleRank('coordinator'));               // 80
    expect(b.grants).toEqual([{ skill: 'tasks.*' }]);
  });

  it('auto-registers a CUSTOM role id when an unknown id + rank are given', () => {
    expect(isKnownRole('warden')).toBe(false);
    const b = defineRoleBundle({ id: 'warden', rank: 70, grants: [{ skill: 'emergency.trigger' }] });
    expect(isKnownRole('warden')).toBe(true);                   // folded into Roles.js
    expect(roleRank('warden')).toBe(70);
    expect(b.rank).toBe(70);
  });

  it('refuses an unknown role id with no rank to slot it', () => {
    expect(() => defineRoleBundle({ id: 'ghost', grants: [{ skill: 'x' }] }))
      .toThrow(/not a known Roles\.js role/);
  });

  it('rejects a rank that disagrees with an already-known role', () => {
    expect(() => defineRoleBundle({ id: 'admin', rank: 55, grants: [{ skill: 'circle.*' }] }))
      .toThrow(/does not match its registered rank/);
  });

  it('validates grant templates: at least one of skill / pod / actingAs', () => {
    expect(() => defineRoleBundle({ id: 'coordinator', grants: [{}] }))
      .toThrow(/at least one of skill \/ pod \/ actingAs/);
    expect(() => defineRoleBundle({ id: 'coordinator', grants: [{ skill: '' }] }))
      .toThrow(/skill must be a non-empty string/);
  });

  it('registers + lists bundles by rank descending', () => {
    registerRoleBundle({ id: 'warden', rank: 70, grants: [{ skill: 'emergency.trigger' }] });
    const ids = listRoleBundles().map((b) => b.id);
    // admin (100, built-in) then warden (70).
    expect(ids).toEqual(['admin', 'warden']);
  });

  it('supports pod + actingAs templates', () => {
    const b = defineRoleBundle({
      id: 'coordinator',
      grants: [
        { pod: 'pod.read:/notes/' },
        { actingAs: 'https://circle.example/agent#bot', skill: 'bot.*' },
      ],
    });
    expect(b.grants[0]).toEqual({ pod: 'pod.read:/notes/' });
    expect(b.grants[1]).toEqual({ actingAs: 'https://circle.example/agent#bot', skill: 'bot.*' });
  });
});

// ── grantRole materializes the bundle ────────────────────────────────────────

async function makeAdmin() {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  const gm       = new GroupManager({ identity, vault });
  return { vault, identity, gm };
}

describe('RoleGrantManager.grant — materializes the bundle', () => {
  const GROUP = 'my-circle';

  it('warden grant: sets the governance role AND issues the bundle cap-token', async () => {
    const admin = await makeAdmin();
    registerRoleBundle({ id: 'warden', rank: 70, grants: [{ skill: 'emergency.trigger' }] });

    // Member W already stands as a plain member.
    const W = 'warden-member-pubkey';
    await admin.gm.issueProof(W, GROUP, { role: 'member' });

    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });
    const res = await mgr.grant({ memberPubKey: W, groupId: GROUP, roleId: 'warden' });

    // (a) governance role set via GroupManager — signed proof, readable back.
    expect(res.roleId).toBe('warden');
    expect(res.rank).toBe(70);
    expect(await admin.gm.getRole(W, GROUP)).toBe('warden');
    expect(await admin.gm.verifyProof(res.proof)).toBe(true);

    // (b) W now HOLDS the materialized cap-token for the bundle — verifiable.
    expect(res.tokens).toHaveLength(1);
    const token = res.tokens[0];
    expect(token.subject).toBe(W);
    expect(token.skill).toBe('emergency.trigger');
    expect(token.agentId).toBe(admin.identity.pubKey);
    expect(token.constraints).toMatchObject({ role: 'warden', group: GROUP });
    expect(CapabilityToken.verify(token, admin.identity.pubKey)).toBe(true);
  });

  it('carries actingAs / pod / per-template TTL from the template into the token', async () => {
    const admin = await makeAdmin();
    registerRoleBundle({
      id: 'steward', rank: 65,
      grants: [
        { skill: 'bot.*', actingAs: 'https://circle.example/agent#steward', expiresIn: 60_000 },
        { pod: 'pod.read:/shared/' },
      ],
    });
    const M = 'steward-pubkey';
    await admin.gm.issueProof(M, GROUP, { role: 'member' });
    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });
    const { tokens } = await mgr.grant({ memberPubKey: M, groupId: GROUP, roleId: 'steward' });

    expect(tokens[0].constraints.actingAs).toBe('https://circle.example/agent#steward');
    expect(tokens[0].expiresAt - tokens[0].issuedAt).toBe(60_000);           // template TTL wins
    expect(tokens[1].constraints.pod).toBe('pod.read:/shared/');
  });

  it('enforces canChangeRole when an actorPubKey is supplied', async () => {
    const admin = await makeAdmin();
    registerRoleBundle({ id: 'warden', rank: 70, grants: [{ skill: 'emergency.trigger' }] });
    const boss = 'boss-pk', target = 'target-pk', weak = 'observer-pk';
    await admin.gm.issueProof(boss,   GROUP, { role: 'admin' });
    await admin.gm.issueProof(target, GROUP, { role: 'member' });
    await admin.gm.issueProof(weak,   GROUP, { role: 'observer' });
    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });

    // Admin actor may grant.
    await expect(mgr.grant({ memberPubKey: target, groupId: GROUP, roleId: 'warden', actorPubKey: boss }))
      .resolves.toMatchObject({ roleId: 'warden' });
    // An observer actor may not.
    await expect(mgr.grant({ memberPubKey: target, groupId: GROUP, roleId: 'warden', actorPubKey: weak }))
      .rejects.toThrow(/may not grant role/);
  });

  it('throws on a role with no registered bundle', async () => {
    const admin = await makeAdmin();
    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });
    await expect(mgr.grant({ memberPubKey: 'x', groupId: GROUP, roleId: 'observer' }))
      .rejects.toThrow(/no role bundle registered/);
  });

  it('materializeBundle can issue tokens without touching governance', async () => {
    const admin = await makeAdmin();
    const bundle = registerRoleBundle({ id: 'warden', rank: 70, grants: [{ skill: 'emergency.trigger' }] });
    const tokens = await materializeBundle({
      identity: admin.identity, agentId: admin.identity.pubKey,
      memberPubKey: 'w', groupId: GROUP, bundle,
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].skill).toBe('emergency.trigger');
  });
});

// ── Enforcement stays PolicyEngine (no second gate) ──────────────────────────

async function setupPolicy(groupManager, agentPubKey) {
  const tr = new TrustRegistry(new VaultMemory());
  const sr = new SkillRegistry();
  const pe = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey, groupManager });
  return { tr, sr, pe };
}

describe('RoleBundle enforcement — through PolicyEngine, not an inline check', () => {
  const GROUP = 'my-circle';

  it('an admin-gated op is allowed for an admin-bundle holder, denied for a plain member', async () => {
    const admin = await makeAdmin();
    const { sr, pe } = await setupPolicy(admin.gm, admin.identity.pubKey);

    // A circle-management skill gated by the admin role — the SAME requiredRole
    // path every governance gate uses (no inline role-string comparison).
    sr.register(defineSkill('circle.setRole', () => 'ok', {
      visibility: 'public', policy: 'always-allow',
      requiredRole: { group: GROUP, role: 'admin' },
    }));

    const A = 'admin-to-be-pk', M = 'plain-member-pk';
    await admin.gm.issueProof(A, GROUP, { role: 'member' });
    await admin.gm.issueProof(M, GROUP, { role: 'member' });

    // Granting the built-in ADMIN bundle promotes A to admin (governance folds in).
    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });
    await mgr.grant({ memberPubKey: A, groupId: GROUP, roleId: 'admin' });

    // A (now admin) passes the requiredRole gate; M (member) is denied.
    await expect(pe.checkInbound({ peerPubKey: A, skillId: 'circle.setRole' }))
      .resolves.toMatchObject({ allowed: true });
    await expect(pe.checkInbound({ peerPubKey: M, skillId: 'circle.setRole' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('a materialized token verifies through checkInbound, then FAILS after revoke', async () => {
    const admin = await makeAdmin();
    const { tr, sr, pe } = await setupPolicy(admin.gm, admin.identity.pubKey);
    // The bundle-granted skill is token-gated (requires-token) — proves the
    // materialized token is what authorises the call.
    sr.register(defineSkill('emergency.trigger', () => 'ok', {
      visibility: 'authenticated', policy: 'requires-token',
    }));

    registerRoleBundle({ id: 'warden', rank: 70, grants: [{ skill: 'emergency.trigger' }] });
    const W = 'warden-pk';
    await admin.gm.issueProof(W, GROUP, { role: 'member' });
    await tr.setTier(admin.identity.pubKey, 'trusted');   // issuer must be trusted to present tokens

    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });
    mgr.installRevocationCheck(pe);                        // BotAgentRegistry-style wiring
    const { tokens } = await mgr.grant({ memberPubKey: W, groupId: GROUP, roleId: 'warden' });
    const token = tokens[0].toJSON();

    // Before revoke: the presented token passes the enforcement path.
    await expect(pe.checkInbound({
      peerPubKey: W, skillId: 'emergency.trigger', token,
    })).resolves.toMatchObject({ allowed: true });

    // Revoke the role → the materialized token is on the revocation list …
    const { revokedTokenIds } = await mgr.revoke({ memberPubKey: W, groupId: GROUP });
    expect(revokedTokenIds).toEqual([tokens[0].id]);
    expect(await mgr.isRevoked(tokens[0].id)).toBe(true);
    // … and the governance role is gone.
    expect(await admin.gm.getRole(W, GROUP)).toBeNull();

    // After revoke: the SAME token no longer passes checkInbound.
    await expect(pe.checkInbound({
      peerPubKey: W, skillId: 'emergency.trigger', token,
    })).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('re-granting a narrower role revokes the previous materialized tokens', async () => {
    const admin = await makeAdmin();
    const { pe } = await setupPolicy(admin.gm, admin.identity.pubKey);
    registerRoleBundle({ id: 'warden', rank: 70, grants: [{ skill: 'emergency.trigger' }] });
    const W = 'w-pk';
    await admin.gm.issueProof(W, GROUP, { role: 'member' });
    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });
    mgr.installRevocationCheck(pe);

    const first  = await mgr.grant({ memberPubKey: W, groupId: GROUP, roleId: 'warden' });
    const second = await mgr.grant({ memberPubKey: W, groupId: GROUP, roleId: 'warden' });
    // The first token is superseded → revoked; the second stands.
    expect(await mgr.isRevoked(first.tokens[0].id)).toBe(true);
    expect(await mgr.isRevoked(second.tokens[0].id)).toBe(false);
    expect(await mgr.materializedTokenIds(W, GROUP)).toEqual([second.tokens[0].id]);
  });
});

/**
 * REVOCATION MUST SURVIVE A RESTART.
 *
 * The revocation set was memory-only, while the tokens it revoked are signed by a stable identity and stay
 * valid until their TTL. So every process restart silently re-admitted every holder that had been cut off —
 * the one failure this whole mechanism exists to prevent, and invisible, because nothing throws when a Set
 * comes back empty.
 *
 * The walk is deliberately shaped as "a new manager over the SAME store": that is what a reboot is.
 */
describe('revocation survives a restart', () => {
  /** A vault-shaped {get,set} port, standing in for whatever durable medium a host supplies. */
  const memStore = (map = new Map()) => ({
    map,
    async get(k) { return map.get(k) ?? null; },
    async set(k, v) { map.set(k, v); },
  });

  it('a manager rebuilt over the same store still knows what was revoked', async () => {
    const admin = await makeAdmin();
    const GROUP = 'restart-circle';
    registerRoleBundle({ id: 'keyholder', rank: 71, grants: [{ skill: 'door.open' }] });
    const M = 'member-pk';
    await admin.gm.issueProof(M, GROUP, { role: 'member' });

    const store = memStore();
    const before = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm, store });
    const { tokens } = await before.grant({ memberPubKey: M, groupId: GROUP, roleId: 'keyholder' });
    await before.revoke({ memberPubKey: M, groupId: GROUP });
    expect(await before.isRevoked(tokens[0].id)).toBe(true);

    // THE RESTART: a brand-new manager, same durable store, nothing carried over in memory.
    const after = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm, store });
    expect(
      await after.isRevoked(tokens[0].id),
      'the restarted process re-admitted a revoked token',
    ).toBe(true);
  });

  it('without a store it is honestly ephemeral — and says so rather than pretending', async () => {
    const admin = await makeAdmin();
    const GROUP = 'ephemeral-circle';
    registerRoleBundle({ id: 'guest', rank: 10, grants: [{ skill: 'door.peek' }] });
    const M = 'guest-pk';
    await admin.gm.issueProof(M, GROUP, { role: 'member' });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mgr = new RoleGrantManager({ identity: admin.identity, groupManager: admin.gm });
    expect(warn, 'a memory-only revocation set must announce itself').toHaveBeenCalledWith(
      expect.stringContaining('MEMORY-ONLY'),
    );
    warn.mockRestore();

    const { tokens } = await mgr.grant({ memberPubKey: M, groupId: GROUP, roleId: 'guest' });
    await mgr.revoke({ memberPubKey: M, groupId: GROUP });
    // In-process it still works; it is only the restart that loses it, which is what the warning says.
    expect(await mgr.isRevoked(tokens[0].id)).toBe(true);
  });
});
