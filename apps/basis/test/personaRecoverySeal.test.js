/**
 * THE RECOVERY SEAL: the recovery file and the registry's pod mirror are sealed to a key derived from the ROOT under a
 * reserved label — not to the default persona's chat key. A device may hold a chosen set of personas, the default
 * among them or not; every phrase ceremony hands it the recovery seal, so whichever personas it holds, it opens the
 * person's file and mirror. The default's chat key opens neither.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { AgentIdentity, Bootstrap } from '@onderling/core';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { openRecoveryFile } from '../src/v2/registryCarrier.js';
import { settingsSealStrategyForIdentity } from '../src/v2/sharedCopyOpener.js';

const strategyFromSeed = async (seed) => settingsSealStrategyForIdentity(await AgentIdentity.fromSeed(seed, new VaultMemory()));

describe('the recovery seal is the root\'s, not the default persona\'s', () => {
  it('the file and the mirror open with the root-derived seal and not with the default\'s key; a restored device holds the seal', async () => {
    const strategies = [];
    const provisionRegistryMedium = async (strategy) => { strategies.push(strategy); return null; };
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), provisionRegistryMedium });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const root = Bootstrap.fromMnemonic(phrase);
    const seal = await strategyFromSeed(root.deriveAgentSeed('recovery-seal'));
    const asDefault = await strategyFromSeed(root.deriveAgentSeed('default'));

    const file = (await phone.callSkill('household', 'exportRecoveryFile', {}))?.file;
    expect(typeof file).toBe('string');
    expect(openRecoveryFile({ strategy: seal, file })?.agents?.length, 'the seal opens the file').toBeGreaterThan(0);
    expect(() => openRecoveryFile({ strategy: asDefault, file }), 'the default\'s key does not').toThrow();

    // the registry mirror is handed the same seal
    expect(strategies.length, 'the mirror was provisioned').toBe(1);
    expect(seal.open(strategies[0].seal('mirror')), 'sealed by the mirror, opened by the seal').toBe('mirror');
    expect(() => asDefault.open(strategies[0].seal('mirror'))).toThrow();

    // a device restored from the phrase (delegation custody: no root after the ceremony) opens the file
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const boot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    const pre = await boot();
    expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    const restored = await boot();
    const imported = await restored.callSkill('household', 'importRecoveryFile', { file });
    expect(imported?.ok, JSON.stringify(imported)).toBe(true);
    // ...and what it exports opens with the same seal
    const again = (await restored.callSkill('household', 'exportRecoveryFile', {}))?.file;
    expect(openRecoveryFile({ strategy: seal, file: again })?.agents?.length).toBeGreaterThan(0);
    await phone.shutdown?.(); await restored.shutdown?.();
  }, 120_000);
});
