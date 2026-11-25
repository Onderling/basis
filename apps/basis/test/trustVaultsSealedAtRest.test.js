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
});
