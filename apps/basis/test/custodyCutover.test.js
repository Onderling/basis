/**
 * THE CUSTODY CUTOVER (the non-resident root): a phrase ceremony ends in DELEGATION custody —
 * the key door holds the device's delegation seed, the vaults seal under it, and the root is
 * never persisted again. The pins here are the cutover's own promises: the door's seed is NOT
 * the root's; the phrase cannot be revealed from the device anymore; and the revoke ceremony
 * still verifies the typed phrase — by re-deriving THIS device's delegation from it, which only
 * the owner's phrase can do.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { Bootstrap } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { readCustodyMode } from '../src/core/agent/ownerRootCustody.js';

describe('the custody cutover — delegation boots without the root', () => {
  it('enroll → the door holds the DELEGATION seed, reveal refuses, revoke still phrase-verifies', async () => {
    // Device 1 (root custody) — the phrase source.
    const dev1 = await createRealHouseholdAgent({
      seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
    });
    const phrase = (await dev1.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const rootSeed = Bootstrap.fromMnemonic(phrase).secret;

    // Device 2: the ceremony, on inspectable stores.
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault });
    const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'cutover-test' });
    expect(en.ok).toBe(true);

    // The cutover's custody facts, inspected directly:
    const mode = await readCustodyMode(ownerRootVault);
    expect(mode.mode).toBe('delegation');
    expect(mode.deviceId).toBe(en.deviceId);
    expect(typeof mode.fingerprint).toBe('string');
    const doorSeed = await rootKeyStore.getSeed();
    expect(doorSeed).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(doorSeed).equals(Buffer.from(rootSeed)), 'the ROOT is not in the door').toBe(false);

    // The delegation boot: works, and cannot give the phrase up.
    const dev2 = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault });
    expect(typeof dev2.circleAddressFor('kring-x')).toBe('string');
    const reveal = await dev2.callSkill('household', 'revealOwnerPhrase', {});
    expect(reveal?.mnemonic).toBeUndefined();
    expect(reveal?.error).toBe('phrase-not-stored');

    // The ceremony's phrase check without a resident root: re-derivation of THIS device's seed.
    const wrong = await dev2.callSkill('household', 'revokeDevice', {
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      deviceId: 'whatever',
    });
    expect(wrong.outcome === 'wrong-phrase' || wrong.outcome === 'invalid-phrase').toBe(true);
    const right = await dev2.callSkill('household', 'revokeDevice', {
      mnemonic: phrase, deviceId: 'some-lost-device', circleIds: ['kring-x'],
    });
    expect(right.ok).toBe(true);
  }, 120_000);
});
