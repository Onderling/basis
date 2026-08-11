// Owner-root custody: the SEED lives behind the platform key door, the phrase is never
// persisted, and a pre-cutover install's cleartext phrase is adopted (then removed) on the
// first boot — but only after the new home PROVES it can read the seed back.
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreMemory, RootKeyStoreVault, ROOT_SEED_VAULT_KEY } from '@onderling/vault';
import { Bootstrap } from '@onderling/core';
import { ensureOwnerRoot, LEGACY_OWNER_PHRASE_KEY } from '../src/core/agent/ownerRootCustody.js';

describe('ensureOwnerRoot — keystore-first custody', () => {
  it('a stored seed IS the identity', async () => {
    const rootKeyStore = new RootKeyStoreMemory();
    const { bootstrap } = Bootstrap.create();
    await rootKeyStore.setSeed(bootstrap.secret);
    const root = await ensureOwnerRoot({ rootKeyStore, legacyVault: new VaultMemory() });
    expect(root.toMnemonic()).toBe(bootstrap.toMnemonic());
  });

  it('adopts a legacy cleartext phrase: seeds the door, deletes the phrase, keeps the identity', async () => {
    const legacyVault = new VaultMemory();
    const { mnemonic } = Bootstrap.create();
    await legacyVault.set(LEGACY_OWNER_PHRASE_KEY, mnemonic);

    const rootKeyStore = new RootKeyStoreMemory();
    const root = await ensureOwnerRoot({ rootKeyStore, legacyVault });

    expect(root.toMnemonic()).toBe(mnemonic);                       // same identity
    expect(await rootKeyStore.getSeed()).toEqual(root.secret);      // seed adopted by the door
    expect(await legacyVault.has(LEGACY_OWNER_PHRASE_KEY)).toBe(false); // phrase gone from rest
  });

  it('a failed readback KEEPS the phrase — worse at rest beats identity-losing', async () => {
    const legacyVault = new VaultMemory();
    const { mnemonic } = Bootstrap.create();
    await legacyVault.set(LEGACY_OWNER_PHRASE_KEY, mnemonic);

    // A door that accepts writes and loses them (the silent-keystore-failure case).
    const brokenStore = { async getSeed() { return null; }, async setSeed() {}, async deleteSeed() {} };
    const root = await ensureOwnerRoot({ rootKeyStore: brokenStore, legacyVault });

    expect(root.toMnemonic()).toBe(mnemonic);                       // this boot still has the identity
    expect(await legacyVault.get(LEGACY_OWNER_PHRASE_KEY)).toBe(mnemonic); // the only copy survived
  });

  it('fresh account: mints a root into the door and NEVER writes a phrase anywhere', async () => {
    const legacyVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreMemory();
    const root = await ensureOwnerRoot({ rootKeyStore, legacyVault });

    expect(await rootKeyStore.getSeed()).toEqual(root.secret);
    expect(await legacyVault.list()).toEqual([]);                   // nothing at rest but the door
    // …and a reboot over the same door returns the same identity
    const again = await ensureOwnerRoot({ rootKeyStore, legacyVault });
    expect(again.toMnemonic()).toBe(root.toMnemonic());
  });

  it('the vault-backed fallback door stores the SEED encoding, not the phrase', async () => {
    const vault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault });
    const root = await ensureOwnerRoot({ rootKeyStore, legacyVault: vault });

    expect(await vault.has(ROOT_SEED_VAULT_KEY)).toBe(true);
    const stored = await vault.get(ROOT_SEED_VAULT_KEY);
    expect(stored).not.toContain(' ');                              // an encoding, not 24 words
    expect(await vault.has(LEGACY_OWNER_PHRASE_KEY)).toBe(false);
    const again = await ensureOwnerRoot({ rootKeyStore: new RootKeyStoreVault({ vault }), legacyVault: vault });
    expect(again.toMnemonic()).toBe(root.toMnemonic());             // survives a "process restart"
  });
});
