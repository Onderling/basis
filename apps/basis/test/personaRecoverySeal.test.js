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
import { archiveSource, hydrateHistory } from '../src/v2/historyMirror.js';
import { EventLog } from '../src/eventLog.js';
import { CachingDataSource } from '@onderling/local-store';

const strategyFromSeed = async (seed) => settingsSealStrategyForIdentity(await AgentIdentity.fromSeed(seed, new VaultMemory()));

describe('the recovery seal is the root\'s, not the default persona\'s', () => {
  it('the file and the mirror open with the root-derived seal and not with the default\'s key; a restored device holds the seal', async () => {
    const strategies = [];
    const provisionRegistryMedium = async (strategy) => { strategies.push(strategy); return null; };
    const settingsStrategies = [];
    const provisionSettingsMedium = async (strategy) => { settingsStrategies.push(strategy); return null; };
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), provisionRegistryMedium, settingsDataSource: new CachingDataSource(), provisionSettingsMedium, deviceLog });
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
    // ...and so are the settings mirror and the history archive: ONE key for everything sealed to the person
    expect(settingsStrategies.length, 'the settings mirror was provisioned').toBe(1);
    expect(seal.open(settingsStrategies[0].seal('settings'))).toBe('settings');
    expect(() => asDefault.open(settingsStrategies[0].seal('settings'))).toThrow();
    deviceLog.append({ id: 'm-1', kind: 'chat-message', circleId: 'c', ts: Date.now(), payload: { text: 'een regel' } });
    const archive = await phone.exportHistoryArchive();
    const back = async (strategy) => {
      const fresh = new EventLog({ initial: [], muted: [] });
      const r = await hydrateHistory({ source: archiveSource(archive, strategy), eventLog: fresh, logger: { warn: () => {} } });
      await r.tailDone;
      return fresh.query().map((e) => e.id);
    };
    expect(await back(seal), 'the seal opens the history archive').toContain('m-1');
    expect(await back(asDefault), 'the default\'s key does not').not.toContain('m-1');

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

describe('a device without the recovery seal gets it at a phrase step, with nothing ticked', () => {
  it('export says why it refuses; receivePersonas with no personas hands only the seal; then the export works', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const boot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    const pre = await boot();
    expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    // a device enrolled before the seal existed: no seal entry in its vault
    await chatVault.delete('recovery-seal-seed');
    const old = await boot();
    expect((await old.callSkill('household', 'exportRecoveryFile', {}))?.error).toBe('no-recovery-seal');
    expect((await old.callSkill('household', 'listReceivablePersonas', {}))?.hasRecoverySeal).toBe(false);
    const got = await old.callSkill('household', 'receivePersonas', { mnemonic: phrase, personas: [] });
    expect(got?.ok, JSON.stringify(got)).toBe(true);
    const after = await boot();
    expect((await after.callSkill('household', 'listReceivablePersonas', {}))?.hasRecoverySeal).toBe(true);
    expect(typeof (await after.callSkill('household', 'exportRecoveryFile', {}))?.file).toBe('string');
    await phone.shutdown?.(); await after.shutdown?.();
  }, 120_000);
});
