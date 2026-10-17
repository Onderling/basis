/**
 * H5 onboarding (invite-link → group-token) — Phase 7 product item #2.
 *
 * Two skills (issueInvite + redeemInvite) wired against a real
 * GroupManager + MemberMap. Two redemption flows:
 *
 *   - **production-style** — caller passes `memberPubKey`; skill mints
 *     a proof bound to it, returns `{groupProof, members, ...}`.
 *   - **testbed-style**    — `onSpawn` hook generates the identity +
 *     spawns runtime, returns `{identity, spawnedUrl}`. Skill redeems
 *     for that pubKey, returns `{groupProof, spawnedUrl, ...}` so the
 *     browser can redirect.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity, GroupManager, defineSkill, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { MemberMap } from '@onderling/identity-resolver';

import { buildOnboardingSkills } from '../src/onboarding.js';

const ADMIN = 'https://id.example/admin';

let admin, members, gm, skills;
beforeEach(async () => {
  admin   = await AgentIdentity.generate(new VaultMemory());
  members = new MemberMap({ initial: [{ webid: ADMIN, displayName: 'Admin', role: 'admin', pubKey: admin.pubKey }] });
  gm      = new GroupManager({ identity: admin, vault: new VaultMemory() });
  skills  = null;
});

function buildSkills({ onSpawn } = {}) {
  return buildOnboardingSkills({
    groupManager: gm,
    members,
    groupId: 'block-42',
    onSpawn,
  });
}

function getSkill(skillsArr, id) {
  const def = skillsArr.find((s) => s.id === id);
  if (!def) throw new Error(`no skill: ${id}`);
  return def;
}

async function call(skillsArr, id, args) {
  const skill = getSkill(skillsArr, id);
  return skill.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     ADMIN,
    agent:    null,
    envelope: null,
  });
}

describe('H5 onboarding — issueInvite skill', () => {
  it('returns a signed unbound invite for the configured group', async () => {
    skills = buildSkills();
    const { invite } = await call(skills, 'issueInvite', {});
    expect(invite.kind).toBe('invite');
    expect(invite.groupId).toBe('block-42');
    expect(invite.adminPubKey).toBe(admin.pubKey);
    expect(invite.role).toBe('member');
    expect(await gm.verifyInvite(invite)).toBe(true);
  });

  it('honours custom role + ttlMs', async () => {
    skills = buildSkills();
    const { invite } = await call(skills, 'issueInvite',
      { role: 'coordinator', ttlMs: 60_000 });
    expect(invite.role).toBe('coordinator');
    expect(invite.expiresAt - invite.issuedAt).toBe(60_000);
  });
});

describe('H5 onboarding — redeemInvite skill (production flow)', () => {
  it('mints a proof for a caller-supplied memberPubKey + adds to MemberMap', async () => {
    skills = buildSkills();
    const { invite } = await call(skills, 'issueInvite', {});

    const memberId = await AgentIdentity.generate(new VaultMemory());
    const result   = await call(skills, 'redeemInvite', {
      invite,
      memberPubKey: memberId.pubKey,
      webid:        'https://id.example/anne',
      displayName:  'Anne',
    });
    expect(result.error).toBeUndefined();
    expect(result.groupProof.memberPubKey).toBe(memberId.pubKey);
    expect(result.groupProof.role).toBe('member');
    expect(await gm.verifyProof(result.groupProof)).toBe(true);
    expect(result.webid).toBe('https://id.example/anne');
    expect(result.displayName).toBe('Anne');
    // MemberMap now has the new member.
    const all = await members.list();
    expect(all.find((m) => m.webid === 'https://id.example/anne')).toBeTruthy();
  });

  it('returns an error when memberPubKey is missing and no spawn hook is configured', async () => {
    skills = buildSkills();
    const { invite } = await call(skills, 'issueInvite', {});
    const r = await call(skills, 'redeemInvite', { invite });
    expect(r.error).toMatch(/memberPubKey required/);
  });

  it('returns an error for an invalid invite', async () => {
    skills = buildSkills();
    const memberId = await AgentIdentity.generate(new VaultMemory());
    const r = await call(skills, 'redeemInvite', {
      invite:       { kind: 'invite', sig: 'AAAA', groupId: 'block-42', expiresAt: 0 },
      memberPubKey: memberId.pubKey,
    });
    expect(r.error).toMatch(/invalid or expired invite/);
  });

  it('rejects a single-use invite on second redemption', async () => {
    skills = buildSkills();
    const { invite } = await call(skills, 'issueInvite', {});
    const m1 = await AgentIdentity.generate(new VaultMemory());
    const m2 = await AgentIdentity.generate(new VaultMemory());
    const r1 = await call(skills, 'redeemInvite', { invite, memberPubKey: m1.pubKey });
    expect(r1.error).toBeUndefined();
    const r2 = await call(skills, 'redeemInvite', { invite, memberPubKey: m2.pubKey });
    expect(r2.error).toMatch(/already redeemed/);
  });
});

describe('H5 onboarding — redeemInvite skill (testbed flow)', () => {
  it('calls onSpawn to mint identity + URL; redeems for the spawn pubKey', async () => {
    const spawnCalls = [];
    const fakeIdentity = await AgentIdentity.generate(new VaultMemory());
    const onSpawn = async ({ webid, displayName, role }) => {
      spawnCalls.push({ webid, displayName, role });
      return { identity: fakeIdentity, spawnedUrl: 'http://127.0.0.1:9000' };
    };
    skills = buildSkills({ onSpawn });

    const { invite } = await call(skills, 'issueInvite', {});
    const result = await call(skills, 'redeemInvite', {
      invite,
      webid:       'https://id.example/bob',
      displayName: 'Bob',
    });

    expect(result.error).toBeUndefined();
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      webid: 'https://id.example/bob', displayName: 'Bob', role: 'member',
    });
    expect(result.memberPubKey).toBe(fakeIdentity.pubKey);
    expect(result.groupProof.memberPubKey).toBe(fakeIdentity.pubKey);
    expect(result.spawnedUrl).toBe('http://127.0.0.1:9000');
  });

  it('reports spawn failure as a soft `error` (no exception bubbling)', async () => {
    const onSpawn = async () => { throw new Error('out of ports'); };
    skills = buildSkills({ onSpawn });
    const { invite } = await call(skills, 'issueInvite', {});
    const r = await call(skills, 'redeemInvite', { invite, displayName: 'X' });
    expect(r.error).toMatch(/spawn failed.*out of ports/);
  });
});
