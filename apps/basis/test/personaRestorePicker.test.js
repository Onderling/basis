/**
 * RESTORE, THEN PICK (persona arc e2): a device restored from the phrase gets the default; which of the person's
 * personas it holds is a choice made once the restored registry is back (it lists them), with the phrase typed again
 * — the one moment the root is in hand — and the picked ones only are handed over. The rest stay absent from this
 * device's vaults.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe('restore with the picker', () => {
  it('a restored device lists the personas it may receive, and runs exactly the ones it is handed', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const b = (await phone.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    // Buurt holds a circle
    const Y = 'circle-of-buurt';
    expect((await phone.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: b })).ok).toBe(true);
    expect((await phone.callSkill('agents', 'setProfileCircleMembership', { id: b, circleId: Y, address: phone.persona(b).circleAddressFor(Y) }))?.ok).toBe(true);
    // the recovery file the person kept (it carries the registry — every profile)
    const file = (await phone.callSkill('household', 'exportRecoveryFile', {}))?.file;
    expect(typeof file, 'a recovery file').toBe('string');

    // a new device restores from the phrase (the ceremony ends in delegation custody, as every phrase ceremony does)
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const registryBackend = createMemoryBackend();   // this device's own registry
    const boot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend });
    const pre = await boot();
    expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    const restored = await boot();
    expect((await restored.callSkill('household', 'importRecoveryFile', { file }))?.ok, 'the file came back').toBe(true);
    expect(restored.persona(b), 'nothing but the default until picked').toBeFalsy();
    expect(restored.circleSelf(Y).webid, 'and Buurt\'s circle is not bound to anything here yet').toBe(restored.identity.chat.pubKey);
    const offered = await restored.callSkill('household', 'listReceivablePersonas', {});
    expect((offered?.personas ?? []).map((p) => p.id).sort()).toEqual([b, w].sort());
    expect(offered.personas.find((p) => p.id === b)?.name).toBe('Buurt');

    // a wrong phrase hands nothing
    const wrong = await restored.callSkill('household', 'receivePersonas', { mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', personas: [b] });
    expect(wrong.ok).toBe(false);

    const got = await restored.callSkill('household', 'receivePersonas', { mnemonic: phrase, personas: [b] });
    expect(got.ok, JSON.stringify(got)).toBe(true);
    const after = await boot();
    expect(after.persona(b)?.chatId?.pubKey, 'Buurt, the same persona as on the phone').toBe(phone.persona(b).chatId.pubKey);
    expect(after.persona(w), 'not Werk').toBeFalsy();
    expect(after.circleSelf(Y).webid, 'Buurt\'s circle is Buurt\'s on the restored device').toBe(phone.persona(b).chatId.pubKey);
    expect((await after.callSkill('household', 'listReceivablePersonas', {}))?.personas?.map((p) => p.id)).toEqual([w]);
    await phone.shutdown?.(); await after.shutdown?.();
  }, 150_000);
});
