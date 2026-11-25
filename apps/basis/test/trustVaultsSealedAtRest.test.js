/**
 * WHO IS TRUSTED AT WHICH TIER IS NOT READABLE ON THE DEVICE.
 *
 * The two trust-level vaults (the host's gate and the peer gate) were written plain on purpose, as "non-secret".
 * They are read after the content key, and who is trusted is metadata about people, so they are sealed like the
 * device's other vaults: each backing is handed to the same seal as the key vaults, which also puts it on the
 * list the self-enroll cutover reseals.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, VAULT_ENC_SENTINEL_KEY } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

describe('the trust-level vaults are sealed at rest', () => {
  it('the host gate writes its own key as private, and the stored value is not readable', async () => {
    const hostTrustVault = new VaultMemory();
    const peerTrustVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), hostTrustVault, peerTrustVault });
    try {
      const keys = (await hostTrustVault.list()).filter((k) => k.startsWith('trust:'));
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) {
        const raw = String(await hostTrustVault.get(k));
        expect(raw).not.toContain('private');
        expect(raw).not.toContain('tier');
      }
      // both backings carry the seal's sentinel: they are opened through the sealed vault, not plain
      expect(await hostTrustVault.get(VAULT_ENC_SENTINEL_KEY)).not.toBeNull();
      expect(await peerTrustVault.get(VAULT_ENC_SENTINEL_KEY)).not.toBeNull();
    } finally { await a.stop?.(); }
  });

  it('no gate, no host: a host trust vault that will not read stops the boot instead of leaving the gate off', async () => {
    const broken = new VaultMemory();
    const fail = () => { throw new Error('storage unreadable'); };
    broken.get = fail; broken.set = fail; broken.has = fail; broken.list = fail;
    let booted = null;
    let err = null;
    try {
      booted = await createRealHouseholdAgent({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), hostTrustVault: broken, peerTrustVault: new VaultMemory() });
    } catch (e) { err = e; }
    try {
      expect(booted?.hostAgent?.policyEngine ?? null, 'never a host without its gate').toBeNull();
      // the vault's own unreadable key stops the boot, not a later check that happens to need the gate
      expect(err?.message ?? '', 'the boot fails on the unreadable trust vault').toMatch(/vault-sentinel/);
    } finally { await booted?.stop?.(); }
  });
});
