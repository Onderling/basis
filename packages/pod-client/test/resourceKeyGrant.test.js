// resourceKeyGrant.test.js — CapabilityToken-gated, per-resource CEK grants.
//
// Real keys + real tokens, no fabrication:
//   • real X25519 sealing keypairs via `generateKeypair`
//   • real Ed25519 identities via `AgentIdentity.generate`
//   • real signed grants via the broker's `issueGrant` (→ CapabilityToken.issue)
//   • real revocation via a vault-backed `TokenRegistry`
//
// Asserts deny-by-default: a holder of a valid A-token unwraps A and reads it; a NON-holder, a token scoped
// to B, and a REVOKED token all get NOTHING. Per-resource isolation: an A-token never unwraps B.
import { describe, it, expect } from 'vitest';
import {
  createResourceKeyGrant, openGrantedResource, resourceScope,
  generateKeypair, isSealed,
} from '../src/sealing/index.js';
import { AgentIdentity, CapabilityToken, TokenRegistry } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

async function setup() {
  const custodian = await AgentIdentity.generate(new VaultMemory());
  const tokenRegistry = new TokenRegistry(new VaultMemory());
  const broker = createResourceKeyGrant({ identity: custodian, tokenRegistry });

  // Seal two distinct resources, each under its OWN per-resource CEK.
  const a = broker.sealResource('resA', 'secret-A: the launch codes');
  const b = broker.sealResource('resB', 'secret-B: the other thing');
  expect(isSealed(a.sealed)).toBe(true);
  expect(isSealed(b.sealed)).toBe(true);
  // Distinct CEKs ⇒ distinct ciphertext even if bodies differ; the two sealed bodies are independent.
  expect(a.sealed).not.toBe(b.sealed);

  return { custodian, tokenRegistry, broker, a, b };
}

describe('resourceKeyGrant — per-resource CEK grant, gated by CapabilityToken', () => {
  it('holder of a valid A-token unwraps A and opens the plaintext', async () => {
    const { broker, a } = await setup();
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    // The grant is a real, signed CapabilityToken bound to the broker + scoped to resA.
    expect(CapabilityToken.verify(token, broker.pubKey)).toBe(true);
    expect(token.skill).toBe(resourceScope('resA'));

    const res = await broker.releaseKey({
      token,
      requesterPubKey:     holderId.pubKey,
      resourceId:          'resA',
      requesterSealPubKey: holderSeal.publicKey,
    });
    expect(res.denied).toBeUndefined();
    expect(isSealed(res.wrappedKey)).toBe(true);

    const plaintext = openGrantedResource({
      wrappedKey:     res.wrappedKey,
      sealPrivateKey: holderSeal.privateKey,
      sealed:         a.sealed,
    });
    expect(plaintext).toBe('secret-A: the launch codes');
  });

  it('per-resource isolation: an A-token cannot release B (wrong scope → no key)', async () => {
    const { broker } = await setup();
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    const tokenA = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });

    const res = await broker.releaseKey({
      token:               tokenA,
      requesterPubKey:     holderId.pubKey,
      resourceId:          'resB',            // asking for B with an A-token
      requesterSealPubKey: holderSeal.publicKey,
    });
    expect(res.wrappedKey).toBeUndefined();
    expect(res.denied).toBe(true);
    expect(res.reason).toBe('wrong-scope');
  });

  it('an A-token holder cannot decrypt B even given B ciphertext (distinct CEKs)', async () => {
    const { broker, b } = await setup();
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    // Legitimately obtain A's key.
    const tokenA = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    const relA = await broker.releaseKey({
      token: tokenA, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey,
    });
    // Using A's key on B's ciphertext must fail (secretbox open throws) — no cross-resource read.
    expect(() => openGrantedResource({
      wrappedKey: relA.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed: b.sealed,
    })).toThrow();
  });

  it('NON-holder (no token) is denied — deny-by-default', async () => {
    const { broker } = await setup();
    const holderSeal = generateKeypair();
    const res = await broker.releaseKey({
      token: null, requesterPubKey: 'whoever', resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey,
    });
    expect(res.wrappedKey).toBeUndefined();
    expect(res.denied).toBe(true);
    expect(res.reason).toBe('no-token');
  });

  it('token theft: a different peer presenting a valid A-token is denied (subject binding)', async () => {
    const { broker } = await setup();
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const thiefSeal  = generateKeypair();

    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });
    const res = await broker.releaseKey({
      token,
      requesterPubKey:     'a-different-peer-pubkey',   // not the token subject
      resourceId:          'resA',
      requesterSealPubKey: thiefSeal.publicKey,
    });
    expect(res.wrappedKey).toBeUndefined();
    expect(res.reason).toBe('subject-mismatch');
  });

  it('REVOKED token is denied even though it is otherwise valid + unexpired', async () => {
    const { broker, tokenRegistry } = await setup();
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'resA' });

    // Pre-revocation: releases fine.
    const before = await broker.releaseKey({
      token, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey,
    });
    expect(before.wrappedKey).toBeDefined();

    // Revoke via the broker (delegates to the vault-backed TokenRegistry).
    await broker.revoke(token.id);
    expect(await tokenRegistry.isRevoked(token.id)).toBe(true);

    // Post-revocation: no key.
    const after = await broker.releaseKey({
      token, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey,
    });
    expect(after.wrappedKey).toBeUndefined();
    expect(after.reason).toBe('revoked');
  });

  it('a forged token (signed by a different identity) is denied (agent binding)', async () => {
    const { broker } = await setup();
    const impostor   = await AgentIdentity.generate(new VaultMemory());
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    // A well-formed token scoped to resA, but signed by someone OTHER than the broker/custodian.
    const forged = await CapabilityToken.issue(impostor, {
      subject: holderId.pubKey,
      agentId: impostor.pubKey,           // not the broker
      skill:   resourceScope('resA'),
    });
    const res = await broker.releaseKey({
      token: forged, requesterPubKey: holderId.pubKey, resourceId: 'resA', requesterSealPubKey: holderSeal.publicKey,
    });
    expect(res.wrappedKey).toBeUndefined();
    expect(res.reason).toBe('invalid-token');
  });

  it('optional pod-side ACL seam (checkGrant) can deny an otherwise-valid grant', async () => {
    const custodian = await AgentIdentity.generate(new VaultMemory());
    const broker = createResourceKeyGrant({
      identity: custodian,
      checkGrant: async ({ resourceId }) => resourceId !== 'blocked', // pretend-ACL
    });
    broker.sealResource('blocked', 'nope');
    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();
    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'blocked' });

    const res = await broker.releaseKey({
      token, requesterPubKey: holderId.pubKey, resourceId: 'blocked', requesterSealPubKey: holderSeal.publicKey,
    });
    expect(res.wrappedKey).toBeUndefined();
    expect(res.reason).toBe('acl');
  });
});

// rotateResource — the revoke-side honesty half (grants-over-Peer D4). A released CEK can't be un-seen, so a
// revoke that must bite re-seals the resource under a fresh key (the ban→rotate posture, per-resource).
describe('rotateResource — re-seal under a fresh CEK', () => {
  it('re-seals the same plaintext under a NEW key: the old CEK no longer opens it, a fresh release does', async () => {
    const custodian = await AgentIdentity.generate(new VaultMemory());
    const broker = createResourceKeyGrant({ identity: custodian });
    const { sealed } = broker.sealResource('doc-1', 'geheim');

    const holderId   = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();
    const token = await broker.issueGrant({ subject: holderId.pubKey, resourceId: 'doc-1' });
    const before = await broker.releaseKey({
      token, requesterPubKey: holderId.pubKey, resourceId: 'doc-1', requesterSealPubKey: holderSeal.publicKey,
    });
    expect(openGrantedResource({ wrappedKey: before.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed })).toBe('geheim');

    const rotated = broker.rotateResource('doc-1', { sealed });
    expect(rotated.rotated).toBe(true);
    expect(rotated.sealed).not.toBe(sealed);

    // The retained old wrapped key opens neither the new body...
    expect(() => openGrantedResource({ wrappedKey: before.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed: rotated.sealed })).toThrow();
    // ...while a still-valid grant obtains the NEW key and reads the content unchanged.
    const after = await broker.releaseKey({
      token, requesterPubKey: holderId.pubKey, resourceId: 'doc-1', requesterSealPubKey: holderSeal.publicKey,
    });
    expect(openGrantedResource({ wrappedKey: after.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed: rotated.sealed })).toBe('geheim');
  });

  it('refuses an unknown resource or a missing body (never silently mints a key)', async () => {
    const custodian = await AgentIdentity.generate(new VaultMemory());
    const broker = createResourceKeyGrant({ identity: custodian });
    expect(() => broker.rotateResource('nope', { sealed: 'x' })).toThrow(/unknown resource/);
    broker.sealResource('doc-2', 'v');
    expect(() => broker.rotateResource('doc-2', {})).toThrow(/current sealed body is required/);
  });
});
