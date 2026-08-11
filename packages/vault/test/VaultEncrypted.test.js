import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { VaultMemory } from '../src/VaultMemory.js';
import {
  VaultEncrypted,
  migrateVaultToEncrypted,
  VAULT_ENC_SENTINEL_KEY,
  VAULT_ENC_VERSION,
} from '../src/VaultEncrypted.js';

const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(9);

describe('VaultEncrypted — the at-rest decorator', () => {
  it('round-trips a value, and the backing store never holds the plaintext', async () => {
    const backing = new VaultMemory();
    const vault = new VaultEncrypted({ backing, key: KEY });
    await vault.set('agent-privkey', 'super-secret-seed');
    expect(await vault.get('agent-privkey')).toBe('super-secret-seed');
    const stored = await backing.get('agent-privkey');
    expect(stored.startsWith('enc1:')).toBe(true);
    expect(stored).not.toContain('super-secret-seed');
  });

  it('the wrong key fails LOUDLY — never a silent null', async () => {
    const backing = new VaultMemory();
    await new VaultEncrypted({ backing, key: KEY }).set('k', 'v');
    const wrong = new VaultEncrypted({ backing, key: OTHER_KEY });
    await expect(wrong.get('k')).rejects.toThrow(/wrong unlock secret/);
  });

  it('refuses to read a plaintext value — an unmigrated store must not pass silently', async () => {
    const backing = new VaultMemory();
    await backing.set('legacy', 'cleartext');
    const vault = new VaultEncrypted({ backing, key: KEY });
    await expect(vault.get('legacy')).rejects.toThrow(/not been migrated/);
  });

  it('a missing key is null (absence is not an error), and list() hides the sentinel', async () => {
    const backing = new VaultMemory();
    await backing.set(VAULT_ENC_SENTINEL_KEY, VAULT_ENC_VERSION);
    const vault = new VaultEncrypted({ backing, key: KEY });
    expect(await vault.get('nope')).toBe(null);
    await vault.set('a', '1');
    expect(await vault.list()).toEqual(['a']);
  });

  it('rejects a malformed key (not 32 bytes)', () => {
    expect(() => new VaultEncrypted({ backing: new VaultMemory(), key: new Uint8Array(16) }))
      .toThrow(/32-byte/);
  });

  it('two encryptions of the same value differ (fresh nonce), both decrypt', async () => {
    const backing = new VaultMemory();
    const vault = new VaultEncrypted({ backing, key: KEY });
    await vault.set('a', 'same');
    const first = await backing.get('a');
    await vault.set('a', 'same');
    expect(await backing.get('a')).not.toBe(first);
    expect(await vault.get('a')).toBe('same');
  });
});

describe('migrateVaultToEncrypted — the one-time sentinel migration', () => {
  const seed = async () => {
    const backing = new VaultMemory();
    await backing.set('owner-phrase', 'abandon abandon ability');
    await backing.set('agent-privkey', 'seed-bytes');
    await backing.set('solid-pod-token', 'tok');
    return backing;
  };

  it('encrypts everything, drops the phrase, sets the sentinel', async () => {
    const backing = await seed();
    const res = await migrateVaultToEncrypted({ backing, key: KEY, drop: ['owner-phrase'] });
    expect(res).toEqual({ migrated: true, sealed: 2, dropped: 1 });
    expect(await backing.get(VAULT_ENC_SENTINEL_KEY)).toBe(VAULT_ENC_VERSION);
    expect(await backing.has('owner-phrase')).toBe(false);   // the phrase exists only in the user's hands now
    for (const k of ['agent-privkey', 'solid-pod-token']) {
      expect(VaultEncrypted.isEncryptedValue(await backing.get(k))).toBe(true);
    }
    const vault = new VaultEncrypted({ backing, key: KEY });
    expect(await vault.get('agent-privkey')).toBe('seed-bytes');
  });

  it('is idempotent: a second run touches nothing', async () => {
    const backing = await seed();
    await migrateVaultToEncrypted({ backing, key: KEY, drop: ['owner-phrase'] });
    const snapshot = backing.snapshot();
    const res = await migrateVaultToEncrypted({ backing, key: KEY, drop: ['owner-phrase'] });
    expect(res.migrated).toBe(false);
    expect(backing.snapshot()).toEqual(snapshot);            // byte-identical — nothing re-encrypted
  });

  it('resumes after a crash mid-migration (some entries already sealed, no sentinel yet)', async () => {
    const backing = await seed();
    // simulate the crash: one entry sealed, sentinel never written
    await new VaultEncrypted({ backing, key: KEY }).set('agent-privkey', 'seed-bytes');
    const res = await migrateVaultToEncrypted({ backing, key: KEY, drop: ['owner-phrase'] });
    expect(res.migrated).toBe(true);
    expect(res.sealed).toBe(1);                              // only the remaining plaintext entry
    const vault = new VaultEncrypted({ backing, key: KEY });
    expect(await vault.get('agent-privkey')).toBe('seed-bytes');
    expect(await vault.get('solid-pod-token')).toBe('tok');
    expect(await backing.has('owner-phrase')).toBe(false);
  });

  it('an empty store migrates to just the sentinel', async () => {
    const backing = new VaultMemory();
    const res = await migrateVaultToEncrypted({ backing, key: KEY });
    expect(res).toEqual({ migrated: true, sealed: 0, dropped: 0 });
    expect(await backing.get(VAULT_ENC_SENTINEL_KEY)).toBe(VAULT_ENC_VERSION);
  });
});

describe('the fingerprint-bound sentinel — a root switch starts the vault clean', () => {
  it('same fingerprint: second run is a noop', async () => {
    const backing = new VaultMemory();
    await backing.set('agent-privkey', 'seed');
    await migrateVaultToEncrypted({ backing, key: KEY, fingerprint: 'aaaa' });
    const res = await migrateVaultToEncrypted({ backing, key: KEY, fingerprint: 'aaaa' });
    expect(res.migrated).toBe(false);
    expect(await backing.get(VAULT_ENC_SENTINEL_KEY)).toBe(`${VAULT_ENC_VERSION}:aaaa`);
  });

  it('a DIFFERENT fingerprint (identity switch) wipes the previous person\'s entries', async () => {
    const backing = new VaultMemory();
    await backing.set('agent-privkey', 'old-person-seed');
    await backing.set('mute-list', 'old-person-mutes');
    await migrateVaultToEncrypted({ backing, key: KEY, fingerprint: 'old-root' });

    const res = await migrateVaultToEncrypted({ backing, key: OTHER_KEY, fingerprint: 'new-root' });
    expect(res).toMatchObject({ migrated: true, reset: true, sealed: 0 });
    expect(await backing.get(VAULT_ENC_SENTINEL_KEY)).toBe(`${VAULT_ENC_VERSION}:new-root`);
    expect(await backing.has('agent-privkey')).toBe(false);   // nothing of the old person carries over
    expect(await backing.has('mute-list')).toBe(false);
    // …and the vault works cleanly under the new key
    const vault = new VaultEncrypted({ backing, key: OTHER_KEY });
    await vault.set('agent-privkey', 'new-person-seed');
    expect(await vault.get('agent-privkey')).toBe('new-person-seed');
  });

  it('a legacy plaintext store (no sentinel) seals IN PLACE under the offered fingerprint — no wipe', async () => {
    const backing = new VaultMemory();
    await backing.set('agent-privkey', 'pre-cutover-seed');
    const res = await migrateVaultToEncrypted({ backing, key: KEY, fingerprint: 'root-a' });
    expect(res).toEqual({ migrated: true, sealed: 1, dropped: 0 });   // adopted, not discarded
    expect(await new VaultEncrypted({ backing, key: KEY }).get('agent-privkey')).toBe('pre-cutover-seed');
  });
});

describe('the phrase-derived key contract (with @onderling/core)', () => {
  it('Bootstrap.deriveVaultAtRestKey is deterministic, 32 bytes, and ≠ any agent seed', async () => {
    const { Bootstrap } = await import('@onderling/core');
    const { bootstrap, mnemonic } = Bootstrap.create();
    const k1 = bootstrap.deriveVaultAtRestKey();
    const k2 = Bootstrap.fromMnemonic(mnemonic).deriveVaultAtRestKey();
    expect(k1).toEqual(k2);                                  // the phrase alone recovers the key
    expect(k1.length).toBe(nacl.secretbox.keyLength);
    expect(k1).not.toEqual(bootstrap.deriveAgentSeed('default'));
    expect(k1).not.toEqual(bootstrap.deriveAgentSeed('vault-at-rest'));  // label collision impossible: own salt
  });
});
