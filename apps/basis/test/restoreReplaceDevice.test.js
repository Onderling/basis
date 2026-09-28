/**
 * A restore ADDS a device; it never clones one (Frits, 2026-09-04 — clone mode withdrawn the same day).
 *
 * Replacing a device that broke in your own hands should be frictionless: the install re-derives the
 * per-circle keys the old device had, so it IS that device again — nothing to announce, no sibling to ask,
 * no admin, no network. Replacing one that walked away must NOT do that: you need your own keys, or you
 * cannot cut the old one off without cutting yourself off too.
 *
 * These pin the difference where it is decided — the derivation root the ceremony leaves behind — plus the
 * two promises that must survive it: the root is still never persisted, and the revoke ceremony still
 * recognises the owner's phrase on a replacement device.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { Bootstrap, deriveDeviceSeed, deriveCircleAddress } from '@onderling/core';
import { restoreOwnerRoot } from '../src/core/agent/ownerRootRestore.js';

const PHRASE = Bootstrap.create().mnemonic;
const CIRCLE = 'circle-oosterpoort';

/** Run a ceremony on fresh stores and report what the key door ended up holding. */
async function ceremony(mode) {
  const ownerRootVault = new VaultMemory();
  const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
  const r = await restoreOwnerRoot({
    mnemonic: PHRASE, rootKeyStore, chatVault: new VaultMemory(), markerVault: ownerRootVault, mode,
  });
  expect(r.ok, `${mode} ceremony`).toBe(true);
  return { r, seed: await rootKeyStore.getSeed() };
}

describe('restoring as an ADDED device (the default, unchanged)', () => {
  it('derives its OWN root, so its circle address differs and it can be revoked alone', async () => {
    const root = Bootstrap.fromMnemonic(PHRASE);
    const profileSeed = root.deriveAgentSeed('default');
    const { r, seed } = await ceremony('add-device');

    expect(deriveCircleAddress(seed, CIRCLE), 'an added device is NOT the device it joins')
      .not.toBe(deriveCircleAddress(profileSeed, CIRCLE));
    expect(Buffer.from(seed).equals(Buffer.from(deriveDeviceSeed(profileSeed, r.deviceId))),
      'and its root is exactly this device\'s delegation').toBe(true);
  });

  it('is what a caller gets when it says nothing — the safe default', async () => {
    const root = Bootstrap.fromMnemonic(PHRASE);
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const r = await restoreOwnerRoot({
      mnemonic: PHRASE, rootKeyStore, chatVault: new VaultMemory(), markerVault: ownerRootVault,
    });
    const seed = await rootKeyStore.getSeed();
    expect(r.ok).toBe(true);
    expect(Buffer.from(seed).equals(Buffer.from(root.deriveAgentSeed('default'))),
      'defaulting must never silently clone').toBe(false);
  });
});
