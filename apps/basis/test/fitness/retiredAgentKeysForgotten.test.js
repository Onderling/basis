/**
 * The household and folio agents are gone: their ops are the host's (one key, one issuer). An install from before
 * still holds the private keys those agents kept at rest, under `cc-household-agent-id:` and `cc-folio-id:`. Nothing
 * owns them now, and a private key at rest that nothing owns is a finding, so the boot forgets both, once.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';

describe('the retired agents\' keys', () => {
  it('a boot forgets what the household and folio agents left at rest', { timeout: 120_000 }, async () => {
    const vaults = new Map();
    const vaultFor = (prefix) => { if (!vaults.has(prefix)) vaults.set(prefix, new VaultMemory()); return vaults.get(prefix); };
    for (const prefix of ['cc-household-agent-id:', 'cc-folio-id:']) {
      await vaultFor(prefix).set('agent-privkey', 'an old private key');
      await vaultFor(prefix).set('agent-pubkey', 'its public half');
    }
    await createRealHouseholdAgent({ seedHousehold: false, vaultFor });
    expect(await vaultFor('cc-household-agent-id:').list()).toEqual([]);
    expect(await vaultFor('cc-folio-id:').list()).toEqual([]);
    // ...and the agents that remain keep theirs
    expect((await vaultFor('cc-host-id:').list()).length).toBeGreaterThan(0);
  });
});
