/**
 * GroupAuthVerifier — unit tests.
 *
 * Locked Q-E.2 (2026-04-28).  Validates the relay's group-membership
 * auth gate against real `GroupManager`-issued proofs (no test fakes
 * for the proof itself — we mint them with the same code the clients
 * will use in production).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { GroupManager, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { GroupAuthVerifier } from '../src/GroupAuthVerifier.js';

// ── Test fixtures ──────────────────────────────────────────────────────────

let admin;
let member;
let gm;

beforeAll(async () => {
  admin  = await AgentIdentity.generate(new VaultMemory());
  member = await AgentIdentity.generate(new VaultMemory());
  gm     = new GroupManager({ identity: admin, vault: new VaultMemory() });
});

async function mintProof({ groupId = 'my-block', role, expiresIn } = {}) {
  // GroupManager.issueProof signature: (memberPubKey, groupId, opts | expiresIn)
  const opts = {};
  if (role)      opts.role      = role;
  if (expiresIn) opts.expiresIn = expiresIn;
  return gm.issueProof(member.pubKey, groupId, opts);
}

// ── Open-mode (legacy) ─────────────────────────────────────────────────────

describe('GroupAuthVerifier — open mode', () => {
  it('accepts every input when acceptedGroups is empty', () => {
    const v = new GroupAuthVerifier();
    expect(v.isOpen).toBe(true);
    expect(v.verify(undefined)).toEqual({ ok: true, group: null });
    expect(v.verify(null)).toEqual({ ok: true, group: null });
    expect(v.verify({ groupId: 'whatever' })).toEqual({ ok: true, group: null });
  });

  it('treats acceptedGroups: [] as open', () => {
    const v = new GroupAuthVerifier({ acceptedGroups: [] });
    expect(v.isOpen).toBe(true);
    expect(v.verify(undefined).ok).toBe(true);
  });
});

// ── Closed-mode rejection paths ────────────────────────────────────────────

describe('GroupAuthVerifier — closed mode rejections', () => {
  it('rejects when no proof is presented', async () => {
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.isOpen).toBe(false);
    expect(v.verify(undefined)).toEqual({ ok: false, reason: 'NO_PROOF' });
    expect(v.verify(null)).toEqual({ ok: false, reason: 'NO_PROOF' });
    expect(v.verify('not-an-object')).toEqual({ ok: false, reason: 'NO_PROOF' });
  });

  it('rejects proofs for a group the relay does not accept', async () => {
    const proof = await mintProof({ groupId: 'other-block' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verify(proof)).toEqual({ ok: false, reason: 'GROUP_NOT_ACCEPTED' });
  });

  it('rejects proofs signed by a different admin pubkey', async () => {
    const proof    = await mintProof({ groupId: 'my-block' });
    const stranger = await AgentIdentity.generate(new VaultMemory());
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: stranger.pubKey }],
    });
    expect(v.verify(proof)).toEqual({ ok: false, reason: 'INVALID_PROOF' });
  });

  it('rejects expired proofs', async () => {
    // Mint a proof that expired 1ms ago: pass negative expiresIn so the
    // proof is born already-expired.
    const proof = await mintProof({ groupId: 'my-block', expiresIn: -1 });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verify(proof)).toEqual({ ok: false, reason: 'INVALID_PROOF' });
  });

  it('rejects tampered proofs (memberPubKey swapped)', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const tampered = { ...proof, memberPubKey: 'AAAA' };
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verify(tampered)).toEqual({ ok: false, reason: 'INVALID_PROOF' });
  });

  it('rejects when the signature itself is corrupted', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    // Flip a couple of base64url chars in the signature.
    const corruptedSig = proof.sig.startsWith('A')
      ? 'B' + proof.sig.slice(1)
      : 'A' + proof.sig.slice(1);
    const tampered = { ...proof, sig: corruptedSig };
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verify(tampered)).toEqual({ ok: false, reason: 'INVALID_PROOF' });
  });
});

// ── Closed-mode happy path ─────────────────────────────────────────────────

describe('GroupAuthVerifier — closed mode happy path', () => {
  it('accepts a valid GroupManager-issued proof', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const cfg   = { groupId: 'my-block', adminPubKey: admin.pubKey };
    const v     = new GroupAuthVerifier({ acceptedGroups: [cfg] });
    const out   = v.verify(proof);
    expect(out.ok).toBe(true);
    expect(out.group).toEqual(cfg);
  });

  it('finds the right group entry when multiple are configured', async () => {
    const otherAdmin = await AgentIdentity.generate(new VaultMemory());
    const proof      = await mintProof({ groupId: 'my-block' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [
        { groupId: 'other-block', adminPubKey: otherAdmin.pubKey },
        { groupId: 'my-block',    adminPubKey: admin.pubKey      },
      ],
    });
    const out = v.verify(proof);
    expect(out.ok).toBe(true);
    expect(out.group.groupId).toBe('my-block');
  });
});

// ── Composition with D3 roles ──────────────────────────────────────────────

describe('GroupAuthVerifier — requiredRole (D3 composition)', () => {
  it('accepts when caller role meets the requirement', async () => {
    const proof = await mintProof({ groupId: 'my-block', role: 'member' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{
        groupId:      'my-block',
        adminPubKey:  admin.pubKey,
        requiredRole: 'member',
      }],
    });
    expect(v.verify(proof).ok).toBe(true);
  });

  it('accepts when caller role exceeds the requirement', async () => {
    const proof = await mintProof({ groupId: 'my-block', role: 'coordinator' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{
        groupId:      'my-block',
        adminPubKey:  admin.pubKey,
        requiredRole: 'member',
      }],
    });
    expect(v.verify(proof).ok).toBe(true);
  });

  it('rejects when caller role rank is below the requirement', async () => {
    const proof = await mintProof({ groupId: 'my-block', role: 'observer' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{
        groupId:      'my-block',
        adminPubKey:  admin.pubKey,
        requiredRole: 'member',
      }],
    });
    expect(v.verify(proof)).toEqual({ ok: false, reason: 'INSUFFICIENT_ROLE' });
  });

  it('honours a custom roleRanks override', async () => {
    // App registers a custom 'vip' role that ranks between observer and member.
    const proof = await mintProof({ groupId: 'my-block', role: 'observer' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{
        groupId:      'my-block',
        adminPubKey:  admin.pubKey,
        requiredRole: 'observer',
      }],
      roleRanks: { observer: 50 }, // tweak default rank — caller still meets it
    });
    expect(v.verify(proof).ok).toBe(true);
  });
});

// ── Phase 2 (Stoop V1, 2026-05-05) — revoked members ──────────────────────

describe('GroupAuthVerifier — revokedMembers (Phase 2C)', () => {
  it('rejects a proof whose memberPubKey is on revokedMembers', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{
        groupId:        'my-block',
        adminPubKey:    admin.pubKey,
        revokedMembers: [member.pubKey],
      }],
    });
    expect(v.verify(proof)).toEqual({ ok: false, reason: 'MEMBER_REVOKED' });
  });

  it('accepts when revokedMembers is empty / absent (back-compat)', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verify(proof).ok).toBe(true);
  });

  it('only rejects matching memberPubKey, not other members of the same group', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const otherKey = 'someoneelse-pubkey-base64url';
    const v = new GroupAuthVerifier({
      acceptedGroups: [{
        groupId:        'my-block',
        adminPubKey:    admin.pubKey,
        revokedMembers: [otherKey],
      }],
    });
    expect(v.verify(proof).ok).toBe(true);
  });
});

// ── Phase 2 (Stoop V1, 2026-05-05) — verifyBound + rotation chain ─────────

describe('GroupAuthVerifier — verifyBound + rotation chain (Phase 2B)', () => {
  it('accepts when proof.memberPubKey === connectingPubKey (no rotation needed)', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verifyBound({ proof, connectingPubKey: member.pubKey }).ok).toBe(true);
  });

  it('rejects BINDING_MISMATCH when no rotation chain is presented', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verifyBound({ proof, connectingPubKey: 'someone-elses-key' }))
      .toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('accepts a valid rotation chain linking old groupProof to new connecting key', async () => {
    const { KeyRotation, AgentIdentity } = await import('@onderling/core');
    const { VaultMemory } = await import('@onderling/vault');
    const proof = await mintProof({ groupId: 'my-block' });
    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    const rotationProof = await KeyRotation.buildProof(member, newIdentity.pubKey, 86_400);

    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verifyBound({ proof, connectingPubKey: newIdentity.pubKey, rotationProof }).ok).toBe(true);
  });

  it('rejects rotation chain with wrong newPubKey link', async () => {
    const { KeyRotation, AgentIdentity } = await import('@onderling/core');
    const { VaultMemory } = await import('@onderling/vault');
    const proof = await mintProof({ groupId: 'my-block' });
    const newIdentity   = await AgentIdentity.generate(new VaultMemory());
    const otherIdentity = await AgentIdentity.generate(new VaultMemory());
    const rotationProof = await KeyRotation.buildProof(member, newIdentity.pubKey, 86_400);

    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    // connecting with a key OTHER than rotation.newPubKey
    expect(v.verifyBound({ proof, connectingPubKey: otherIdentity.pubKey, rotationProof }))
      .toEqual({ ok: false, reason: 'INVALID_ROTATION' });
  });

  it('rejects rotation chain with tampered signature', async () => {
    const { KeyRotation, AgentIdentity } = await import('@onderling/core');
    const { VaultMemory } = await import('@onderling/vault');
    const proof = await mintProof({ groupId: 'my-block' });
    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    const rotationProof = await KeyRotation.buildProof(member, newIdentity.pubKey, 86_400);
    rotationProof.sig = rotationProof.sig.slice(0, -2) + 'xx';

    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verifyBound({ proof, connectingPubKey: newIdentity.pubKey, rotationProof }))
      .toEqual({ ok: false, reason: 'INVALID_ROTATION' });
  });

  it('rejects rotation chain past its grace period', async () => {
    const { KeyRotation, AgentIdentity } = await import('@onderling/core');
    const { VaultMemory } = await import('@onderling/vault');
    const proof = await mintProof({ groupId: 'my-block' });
    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    const rotationProof = await KeyRotation.buildProof(member, newIdentity.pubKey, 60); // 60 seconds
    // simulate "now" 10 minutes later via the now injection
    const tenMinLater = rotationProof.issuedAt + 600_000;

    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
    expect(v.verifyBound({ proof, connectingPubKey: newIdentity.pubKey, rotationProof, now: () => tenMinLater }))
      .toEqual({ ok: false, reason: 'ROTATION_EXPIRED' });
  });

  it('open mode: verifyBound returns ok even with mismatching keys', async () => {
    const v = new GroupAuthVerifier();   // no acceptedGroups
    expect(v.verifyBound({ proof: undefined, connectingPubKey: 'anything' }).ok).toBe(true);
  });

  it('verifyBound throws if connectingPubKey is missing', async () => {
    const v = new GroupAuthVerifier({
      acceptedGroups: [{ groupId: 'g', adminPubKey: admin.pubKey }],
    });
    expect(() => v.verifyBound({ proof: undefined })).toThrow(/connectingPubKey/);
  });

  it('verifyBound surfaces the same MEMBER_REVOKED reason when applicable', async () => {
    const proof = await mintProof({ groupId: 'my-block' });
    const v = new GroupAuthVerifier({
      acceptedGroups: [{
        groupId:        'my-block',
        adminPubKey:    admin.pubKey,
        revokedMembers: [member.pubKey],
      }],
    });
    expect(v.verifyBound({ proof, connectingPubKey: member.pubKey }))
      .toEqual({ ok: false, reason: 'MEMBER_REVOKED' });
  });
});
