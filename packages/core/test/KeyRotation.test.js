import { describe, it, expect } from 'vitest';
import { KeyRotation }   from '../src/identity/KeyRotation.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '@onderling/vault';
import { TrustRegistry } from '../src/permissions/TrustRegistry.js';

async function makeId() {
  return AgentIdentity.generate(new VaultMemory());
}

// ── buildProof ────────────────────────────────────────────────────────────────

describe('KeyRotation.buildProof', () => {
  it('returns a proof with correct fields', async () => {
    const oldId  = await makeId();
    const newId  = await makeId();
    const proof  = await KeyRotation.buildProof(oldId, newId.pubKey);

    expect(proof.type).toBe('key-rotation');
    expect(proof.oldPubKey).toBe(oldId.pubKey);
    expect(proof.newPubKey).toBe(newId.pubKey);
    expect(typeof proof.issuedAt).toBe('number');
    expect(proof.gracePeriod).toBe(604_800);
    expect(typeof proof.sig).toBe('string');
  });

  it('accepts custom gracePeriod', async () => {
    const id    = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(id, newId.pubKey, 3600);
    expect(proof.gracePeriod).toBe(3600);
  });
});

// ── verify ────────────────────────────────────────────────────────────────────

describe('KeyRotation.verify', () => {
  it('verifies a freshly built proof', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    expect(KeyRotation.verify(proof)).toBe(true);
  });

  it('verifies with explicit oldPubKey', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    expect(KeyRotation.verify(proof, oldId.pubKey)).toBe(true);
  });

  it('rejects when expectedOldPubKey does not match', async () => {
    const oldId  = await makeId();
    const newId  = await makeId();
    const third  = await makeId();
    const proof  = await KeyRotation.buildProof(oldId, newId.pubKey);
    expect(KeyRotation.verify(proof, third.pubKey)).toBe(false);
  });

  it('rejects a tampered newPubKey', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    const tampered = { ...proof, newPubKey: (await makeId()).pubKey };
    expect(KeyRotation.verify(tampered)).toBe(false);
  });

  it('rejects a proof with missing sig', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    const { sig, ...noSig } = proof;
    expect(KeyRotation.verify(noSig)).toBe(false);
  });

  it('rejects a proof with wrong type field', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    expect(KeyRotation.verify({ ...proof, type: 'something-else' })).toBe(false);
  });
});

// ── isWithinGracePeriod ───────────────────────────────────────────────────────

describe('KeyRotation.isWithinGracePeriod', () => {
  it('returns true for a freshly issued proof', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(oldId, newId.pubKey, 3600);
    expect(KeyRotation.isWithinGracePeriod(proof)).toBe(true);
  });

  it('returns false for an expired grace period', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const proof = await KeyRotation.buildProof(oldId, newId.pubKey, 0);
    // gracePeriod = 0 → already expired
    expect(KeyRotation.isWithinGracePeriod(proof)).toBe(false);
  });
});

// ── applyToRegistry ───────────────────────────────────────────────────────────

describe('KeyRotation.applyToRegistry', () => {
  it('copies tier from old key to new key', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const tr    = new TrustRegistry(new VaultMemory());
    await tr.setTier(oldId.pubKey, 'trusted');

    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    await KeyRotation.applyToRegistry(proof, tr);

    expect(await tr.getTier(newId.pubKey)).toBe('trusted');
    // Old key still present (removeOld defaults to false).
    expect(await tr.getTier(oldId.pubKey)).toBe('trusted');
  });

  it('copies group memberships to new key', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const tr    = new TrustRegistry(new VaultMemory());
    await tr.addGroup(oldId.pubKey, 'home');
    await tr.addGroup(oldId.pubKey, 'neighbourhood');

    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    await KeyRotation.applyToRegistry(proof, tr);

    const rec = await tr.getRecord(newId.pubKey);
    expect(rec.groups).toContain('home');
    expect(rec.groups).toContain('neighbourhood');
  });

  it('demotes old key when removeOld = true', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const tr    = new TrustRegistry(new VaultMemory());
    await tr.setTier(oldId.pubKey, 'trusted');

    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    await KeyRotation.applyToRegistry(proof, tr, { removeOld: true });

    expect(await tr.getTier(newId.pubKey)).toBe('trusted');
    expect(await tr.getTier(oldId.pubKey)).toBe('public');
  });

  it('new key inherits tokenIds', async () => {
    const oldId = await makeId();
    const newId = await makeId();
    const tr    = new TrustRegistry(new VaultMemory());
    await tr.addTokenGrant(oldId.pubKey, 'tok-abc');

    const proof = await KeyRotation.buildProof(oldId, newId.pubKey);
    await KeyRotation.applyToRegistry(proof, tr);

    const rec = await tr.getRecord(newId.pubKey);
    expect(rec.tokenIds).toContain('tok-abc');
  });
});
