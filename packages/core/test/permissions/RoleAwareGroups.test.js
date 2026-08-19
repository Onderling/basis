import { describe, it, expect, beforeEach } from 'vitest';

import {
  ROLES,
  roleRank,
  isStandardRole,
  isKnownRole,
  registerCustomRole,
  unregisterCustomRole,
  canPromote,
  listKnownRoles,
} from '../../src/permissions/Roles.js';

import { GroupManager }    from '../../src/permissions/GroupManager.js';
import { PolicyEngine, PolicyDeniedError } from '../../src/permissions/PolicyEngine.js';
import { TrustRegistry }   from '../../src/permissions/TrustRegistry.js';
import { SkillRegistry }   from '../../src/skills/SkillRegistry.js';
import { defineSkill }     from '../../src/skills/defineSkill.js';
import { AgentIdentity }   from '../../src/identity/AgentIdentity.js';
import { VaultMemory }     from '@onderling/vault';

// ── Roles.js ─────────────────────────────────────────────────────────────────

describe('Roles — standard taxonomy', () => {
  it('exposes the five standard role constants', () => {
    expect(ROLES.ADMIN).toBe('admin');
    expect(ROLES.COORDINATOR).toBe('coordinator');
    expect(ROLES.MEMBER).toBe('member');
    expect(ROLES.OBSERVER).toBe('observer');
    expect(ROLES.EXTERNAL).toBe('external');
  });

  it('isStandardRole identifies the five roles', () => {
    for (const r of ['admin', 'coordinator', 'member', 'observer', 'external']) {
      expect(isStandardRole(r)).toBe(true);
    }
    expect(isStandardRole('whatever')).toBe(false);
    expect(isStandardRole(null)).toBe(false);
    expect(isStandardRole(42)).toBe(false);
  });

  it('roleRank returns the documented hierarchy', () => {
    expect(roleRank('admin')).toBe(100);
    expect(roleRank('coordinator')).toBe(80);
    expect(roleRank('member')).toBe(60);
    expect(roleRank('observer')).toBe(40);
    expect(roleRank('external')).toBe(20);
    expect(roleRank('unknown')).toBeUndefined();
  });

  it('canPromote enforces strict hierarchy with admin override', () => {
    expect(canPromote('admin', 'admin')).toBe(true);          // admin override
    expect(canPromote('admin', 'observer')).toBe(true);
    expect(canPromote('coordinator', 'member')).toBe(true);
    expect(canPromote('member', 'observer')).toBe(true);
    expect(canPromote('member', 'member')).toBe(false);       // not strictly above
    expect(canPromote('observer', 'member')).toBe(false);
    expect(canPromote('unknown', 'member')).toBe(false);
    expect(canPromote('member', 'unknown')).toBe(false);
  });
});

describe('Roles — custom registration', () => {
  beforeEach(() => {
    // Defensive: clear any custom roles between tests.
    for (const r of listKnownRoles()) {
      if (!isStandardRole(r)) {
        try { unregisterCustomRole(r); } catch { /* ignore */ }
      }
    }
  });

  it('registers and ranks a custom role', () => {
    registerCustomRole('arbiter', 90);
    expect(isKnownRole('arbiter')).toBe(true);
    expect(roleRank('arbiter')).toBe(90);
    // Falls between admin (100) and coordinator (80) in canPromote ordering.
    expect(canPromote('admin', 'arbiter')).toBe(true);
    expect(canPromote('arbiter', 'coordinator')).toBe(true);
    expect(canPromote('coordinator', 'arbiter')).toBe(false);
    unregisterCustomRole('arbiter');
  });

  it('rejects collisions with standard roles', () => {
    expect(() => registerCustomRole('admin', 99)).toThrow(/standard role/);
  });

  it('rejects rank collisions with standard roles', () => {
    expect(() => registerCustomRole('vip', 100)).toThrow(/collides with a standard role/);
  });

  it('rejects double registration', () => {
    registerCustomRole('arbiter', 90);
    expect(() => registerCustomRole('arbiter', 91)).toThrow(/already registered/);
    unregisterCustomRole('arbiter');
  });

  it('rejects rank collisions across custom roles', () => {
    registerCustomRole('arbiter', 90);
    expect(() => registerCustomRole('judge', 90)).toThrow(/collides with custom role/);
    unregisterCustomRole('arbiter');
  });

  it('refuses to unregister a standard role', () => {
    expect(() => unregisterCustomRole('admin')).toThrow(/cannot unregister standard role/);
  });

  it('rejects malformed inputs', () => {
    expect(() => registerCustomRole('', 99)).toThrow(/non-empty string/);
    expect(() => registerCustomRole(42, 99)).toThrow(/non-empty string/);
    expect(() => registerCustomRole('x', NaN)).toThrow(/finite positive number/);
    expect(() => registerCustomRole('x', -5)).toThrow(/finite positive number/);
  });
});

// ── GroupManager — role-aware operations ─────────────────────────────────────

async function makeAgent() {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  return { vault, identity };
}

describe('GroupManager — role on issueProof', () => {
  it('defaults role to "member" when no opts are given', async () => {
    const a    = await makeAgent();
    const gm   = new GroupManager({ identity: a.identity, vault: a.vault });
    const proof = await gm.issueProof('peer-pubkey', 'g1');
    expect(proof.role).toBe('member');
  });

  it('honours explicit role on issueProof', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    const proof = await gm.issueProof('peer-pubkey', 'g1', { role: 'coordinator' });
    expect(proof.role).toBe('coordinator');
    expect(await gm.verifyProof(proof)).toBe(true);
  });

  it('rejects unknown roles on issueProof', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await expect(gm.issueProof('peer', 'g1', { role: 'wizard' })).rejects.toThrow(/unknown role/);
  });

  it('legacy two-arg call (expiresIn as third arg) still works', async () => {
    const a    = await makeAgent();
    const gm   = new GroupManager({ identity: a.identity, vault: a.vault });
    const proof = await gm.issueProof('peer-pubkey', 'g1', 60_000);
    expect(proof.role).toBe('member');
    expect(proof.expiresAt - proof.issuedAt).toBe(60_000);
  });
});

describe('GroupManager — getRole / listMembersByRole', () => {
  it('returns the issued role', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await gm.issueProof('alice-pk', 'g1', { role: 'coordinator' });
    expect(await gm.getRole('alice-pk', 'g1')).toBe('coordinator');
  });

  it('returns null for non-members', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    expect(await gm.getRole('nobody', 'g1')).toBeNull();
  });

  it('listMembersByRole filters by role', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await gm.issueProof('alice-pk', 'g1', { role: 'coordinator' });
    await gm.issueProof('bob-pk',   'g1', { role: 'member' });
    await gm.issueProof('carol-pk', 'g1', { role: 'member' });
    expect(await gm.listMembersByRole('g1', 'member')).toEqual(
      expect.arrayContaining(['bob-pk', 'carol-pk']),
    );
    expect(await gm.listMembersByRole('g1', 'coordinator')).toEqual(['alice-pk']);
    expect(await gm.listMembersByRole('g1', 'admin')).toEqual([]);
  });
});

describe('GroupManager.setRole — atomic role change', () => {
  it('replaces the existing proof in one vault transaction', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await gm.issueProof('alice-pk', 'g1', { role: 'member' });
    const newProof = await gm.setRole('alice-pk', 'g1', 'coordinator');
    expect(newProof.role).toBe('coordinator');
    expect(await gm.getRole('alice-pk', 'g1')).toBe('coordinator');
    // Vault should have only ONE proof for alice — atomic replace, not append.
    const issued = JSON.parse(await a.vault.get('group-admin:g1'));
    expect(issued.filter((p) => p.memberPubKey === 'alice-pk')).toHaveLength(1);
  });

  it('rejects unknown roles', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await gm.issueProof('alice-pk', 'g1', { role: 'member' });
    await expect(gm.setRole('alice-pk', 'g1', 'czar')).rejects.toThrow(/unknown role/);
  });

  it('demotion is just setRole at a lower rank', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await gm.issueProof('alice-pk', 'g1', { role: 'coordinator' });
    await gm.setRole('alice-pk', 'g1', 'observer');
    expect(await gm.getRole('alice-pk', 'g1')).toBe('observer');
  });
});

describe('GroupManager — backward compatibility with role-less proofs', () => {
  it('verifyProof accepts proofs without a role field (legacy shape)', async () => {
    const a   = await makeAgent();
    // Build a legacy proof manually — same canonical body the pre-D3
    // implementation signed: { groupId, adminPubKey, memberPubKey, issuedAt, expiresAt }.
    // Done through a fresh GroupManager that bypasses the new role default —
    // simplest way is to inject directly into the vault.
    const now      = Date.now();
    const body     = { groupId: 'g1', adminPubKey: a.identity.pubKey, memberPubKey: 'legacy-pk',
                       issuedAt: now, expiresAt: now + 60_000 };
    const sig      = a.identity.sign(JSON.stringify(body, Object.keys(body).sort()));
    const legacy   = { ...body, sig: btoa(String.fromCharCode(...sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') };
    // Inject straight into the vault under the admin key.
    await a.vault.set('group-admin:g1', JSON.stringify([legacy]));

    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    expect(await gm.verifyProof(legacy)).toBe(true);
    // Reading back the role for a legacy proof returns the default.
    expect(await gm.getRole('legacy-pk', 'g1')).toBe('member');
  });
});

describe('GroupManager.canChangeRole', () => {
  it('admin can change anyone', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await gm.issueProof('boss-pk',  'g1', { role: 'admin' });
    await gm.issueProof('alice-pk', 'g1', { role: 'coordinator' });
    expect(await gm.canChangeRole('boss-pk', 'alice-pk', 'g1')).toBe(true);
  });

  it('coordinator cannot change admin', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    await gm.issueProof('boss-pk',  'g1', { role: 'admin' });
    await gm.issueProof('alice-pk', 'g1', { role: 'coordinator' });
    expect(await gm.canChangeRole('alice-pk', 'boss-pk', 'g1')).toBe(false);
  });

  it('returns false for non-members on either side', async () => {
    const a  = await makeAgent();
    const gm = new GroupManager({ identity: a.identity, vault: a.vault });
    expect(await gm.canChangeRole('nobody', 'someone', 'g1')).toBe(false);
  });
});

// ── PolicyEngine — requiredRole wiring ────────────────────────────────────────

async function setupPolicy() {
  const guardId = await AgentIdentity.generate(new VaultMemory());
  const tr      = new TrustRegistry(new VaultMemory());
  const sr      = new SkillRegistry();
  const gm      = new GroupManager({ identity: guardId, vault: new VaultMemory() });
  const pe      = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey: guardId.pubKey, groupManager: gm });
  return { tr, sr, gm, pe, guardId };
}

describe('PolicyEngine — requiredRole', () => {
  it('admits a caller whose role is at or above the required rank', async () => {
    const { sr, gm, pe } = await setupPolicy();
    sr.register(defineSkill('gardenInfo', () => 'ok', {
      visibility: 'public',
      policy:  'always-allow',
      requiredRole: { group: 'my-block', role: 'member' },
    }));
    await gm.issueProof('alice-pk', 'my-block', { role: 'coordinator' });
    const r = await pe.checkInbound({ peerPubKey: 'alice-pk', skillId: 'gardenInfo' });
    expect(r.allowed).toBe(true);
  });

  it('rejects a caller whose role is below the required rank', async () => {
    const { sr, gm, pe } = await setupPolicy();
    sr.register(defineSkill('admin-only', () => 'ok', {
      visibility: 'public',
      policy:  'always-allow',
      requiredRole: { group: 'my-block', role: 'coordinator' },
    }));
    await gm.issueProof('alice-pk', 'my-block', { role: 'observer' });
    await expect(pe.checkInbound({ peerPubKey: 'alice-pk', skillId: 'admin-only' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('rejects a non-member with NOT_A_MEMBER', async () => {
    const { sr, pe } = await setupPolicy();
    sr.register(defineSkill('gardenInfo', () => 'ok', {
      visibility: 'public',
      policy:  'always-allow',
      requiredRole: { group: 'my-block', role: 'member' },
    }));
    await expect(pe.checkInbound({ peerPubKey: 'nobody-pk', skillId: 'gardenInfo' }))
      .rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
  });

  it('throws when groupManager is not wired but a skill declares requiredRole', async () => {
    const guardId = await AgentIdentity.generate(new VaultMemory());
    const tr      = new TrustRegistry(new VaultMemory());
    const sr      = new SkillRegistry();
    const pe      = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey: guardId.pubKey });  // NO groupManager
    sr.register(defineSkill('admin-only', () => 'ok', {
      visibility: 'public',
      policy:  'always-allow',
      requiredRole: { group: 'my-block', role: 'coordinator' },
    }));
    await expect(pe.checkInbound({ peerPubKey: 'alice-pk', skillId: 'admin-only' }))
      .rejects.toMatchObject({ code: 'NO_GROUP_MANAGER' });
  });

  it('rejects a malformed requiredRole', async () => {
    const { sr, gm, pe } = await setupPolicy();
    sr.register(defineSkill('broken', () => 'ok', {
      visibility: 'public',
      policy:  'always-allow',
      requiredRole: { role: 'coordinator' },  // missing group
    }));
    // Caller doesn't matter — we never get to the role check.
    await gm.issueProof('alice-pk', 'my-block', { role: 'admin' });
    await expect(pe.checkInbound({ peerPubKey: 'alice-pk', skillId: 'broken' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUIRED_ROLE' });
  });

  it('skips the role check when a skill has no requiredRole', async () => {
    const { sr, pe } = await setupPolicy();
    sr.register(defineSkill('open', () => 'ok', {
      visibility: 'public',
      policy:  'always-allow',
    }));
    const r = await pe.checkInbound({ peerPubKey: 'random-pk', skillId: 'open' });
    expect(r.allowed).toBe(true);
  });
});

describe('PolicyEngine — backward compatibility for skills without requiredRole', () => {
  it('existing visibility-only skills behave unchanged', async () => {
    const { tr, sr, pe } = await setupPolicy();
    sr.register(defineSkill('public-thing', () => 'ok', {
      visibility: 'public',
      policy:  'always-allow',
    }));
    const r = await pe.checkInbound({ peerPubKey: 'anyone', skillId: 'public-thing' });
    expect(r.allowed).toBe(true);
    expect(r.tier).toBe('authenticated');
  });
});
