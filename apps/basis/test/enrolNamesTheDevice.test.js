/**
 * AN ENROLLED DEVICE IS NAMED BY ITS MODEL in the person's own device list. The enroll flow never fills its optional
 * label, so every other device of the person read "another device" for it. The agent now records the model the shell
 * hands it (`enrolDeviceName`: the phone's, the browser's) as the delegation label when the person typed none; a typed
 * label still wins. The label rides the delegation, which only the person's own devices read.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { deviceDelegationsOf } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

async function enrolled({ label, enrolDeviceName }) {
  const dev1 = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
  const phrase = (await dev1.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
  const ownerRootVault = new VaultMemory();
  const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
  const chatVault = new VaultMemory();
  const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, enrolDeviceName });
  const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, ...(label ? { label } : {}) });
  expect(en.ok).toBe(true);
  const dev2 = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, enrolDeviceName });
  const props = await dev2.callSkill('agents', 'getProfileProperties', { id: 'default' });
  const mine = Object.values(deviceDelegationsOf({ properties: props?.properties ?? {} })).find((d) => d?.deviceId === en.deviceId);
  return mine?.label ?? null;
}

describe('an enrolled device is named', () => {
  it('by the model the shell reads, when the person typed no name', async () => {
    expect(await enrolled({ enrolDeviceName: () => 'SM-A336B' })).toBe('SM-A336B');
  });
  it('by the name the person typed, which wins over the model', async () => {
    expect(await enrolled({ label: 'werktelefoon', enrolDeviceName: () => 'SM-A336B' })).toBe('werktelefoon');
  });
});
