/**
 * The person key: derived from the root per profile and version, kept sealed on an enrolled device, announced to a
 * circle as `{ version, pubKey }`.
 */
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '../src/identity/Bootstrap.js';
import { derivePersonKeySeed, personKeyPubKeyB64, personKeyAnnouncement, loadPersonKey, storePersonKey, signWithPersonKey } from '../src/identity/personKey.js';
import { VaultMemory } from '@onderling/vault';
import nacl from 'tweetnacl';
import { decode as b64decode } from '../src/crypto/b64.js';

const root = Bootstrap.create().bootstrap;
const profile = root.deriveAgentSeed('default');

describe('derivation', () => {
  it('is deterministic per (root, profile, version), differs per version, and is not the profile key', () => {
    const v1 = derivePersonKeySeed(profile, 1), again = derivePersonKeySeed(profile, 1), v2 = derivePersonKeySeed(profile, 2);
    expect(personKeyPubKeyB64(v1)).toBe(personKeyPubKeyB64(again));
    expect(personKeyPubKeyB64(v1)).not.toBe(personKeyPubKeyB64(v2));
    expect(personKeyPubKeyB64(v1)).not.toBe(personKeyPubKeyB64(profile));
    expect(personKeyPubKeyB64(derivePersonKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default'), 1))).not.toBe(personKeyPubKeyB64(v1));
  });
  it('signs verifiably under its public key', () => {
    const seed = derivePersonKeySeed(profile, 1);
    const msg = new TextEncoder().encode('hoi');
    expect(nacl.sign.detached.verify(msg, b64decode(signWithPersonKey(seed, msg)), b64decode(personKeyPubKeyB64(seed)))).toBe(true);
  });
  it('refuses junk', () => {
    expect(() => derivePersonKeySeed(new Uint8Array(31), 1)).toThrow();
    expect(() => derivePersonKeySeed(profile, 0)).toThrow();
  });
});

describe('the announcement shape', () => {
  it('normalises a well-formed key and rejects the rest', () => {
    expect(personKeyAnnouncement({ version: 2, pubKey: 'K', extra: 1 })).toEqual({ version: 2, pubKey: 'K' });
    for (const bad of [null, {}, { version: 0, pubKey: 'K' }, { version: '1', pubKey: 'K' }, { version: 1 }, { version: 1, pubKey: '' }]) expect(personKeyAnnouncement(bad)).toBe(null);
  });
});

describe('the sealed-vault entry', () => {
  it('round-trips, never rolls back, and reads absent/malformed as null', async () => {
    const vault = new VaultMemory();
    expect(await loadPersonKey(vault)).toBe(null);
    const v1 = derivePersonKeySeed(profile, 1), v2 = derivePersonKeySeed(profile, 2);
    expect(await storePersonKey(vault, { version: 1, seed: v1 })).toBe(true);
    expect(await loadPersonKey(vault)).toEqual({ version: 1, seed: v1, reveals: {} });
    expect(await storePersonKey(vault, { version: 1, seed: v2 }), 'same version: kept').toBe(false);
    expect(await storePersonKey(vault, { version: 2, seed: v2, reveals: { c1: { rootPubKey: 'r', sig: 's' } } })).toBe(true);
    expect((await loadPersonKey(vault)).reveals, 'the reveals ride beside the key').toEqual({ c1: { rootPubKey: 'r', sig: 's' } });
    expect(await storePersonKey(vault, { version: 1, seed: v1 }), 'a lower version never lands').toBe(false);
    expect((await loadPersonKey(vault)).version).toBe(2);
    await vault.set('person-key', '{"version":3}');
    expect(await loadPersonKey(vault)).toBe(null);
  });
});
