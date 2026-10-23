/**
 * A relaunch derives each key once.
 *
 * Counted on a relaunch (2026-10-23): 18 seed→keypair derivations over 12 distinct seeds. Five were the in-process
 * key check restoring each in-process identity a second time; one was the persona's authority key derived twice; and
 * the settings seal strategy re-ran the identity's ed2curve conversion on every call. Each is a pure-JS Ed25519 or
 * curve operation — tens of milliseconds apiece on a phone.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

afterEach(() => { vi.restoreAllMocks(); });

function deviceStorage() {
  const vaults = new Map();
  const ownerRootVault = new VaultMemory();
  return {
    vaultFor: (prefix) => { if (!vaults.has(prefix)) vaults.set(prefix, new VaultMemory()); return vaults.get(prefix); },
    ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }),
    chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
  };
}

describe('a relaunch derives each key once', () => {
  it('no identity vault is restored twice, and the seal strategy is built once per identity', { timeout: 120_000 }, async () => {
    const device = deviceStorage();
    await createRealHouseholdAgent({ seedHousehold: false, ...device });

    const restored = [];
    const realRestore = AgentIdentity.restore.bind(AgentIdentity);
    vi.spyOn(AgentIdentity, 'restore').mockImplementation(async (vault) => { restored.push(vault); return realRestore(vault); });
    const openers = new Map();
    const realOpener = AgentIdentity.prototype.sharedCopyOpener;
    vi.spyOn(AgentIdentity.prototype, 'sharedCopyOpener').mockImplementation(function (fn) {
      openers.set(this, (openers.get(this) ?? 0) + 1);
      return realOpener.call(this, fn);
    });

    await createRealHouseholdAgent({ seedHousehold: false, ...device });   // the relaunch

    const twice = restored.filter((v, i) => restored.indexOf(v) !== i);
    expect(twice.length, 'an identity vault was restored more than once in one boot').toBe(0);
    for (const n of openers.values()) expect(n, 'the seal strategy re-derived its keypair').toBe(1);
  });
});
