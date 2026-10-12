/**
 * ENROL WITH THE PICKER (persona arc e1): a new device is handed the personas the person CHOOSES for it, at the one
 * moment the phrase is in hand. The offer names the person's personas only SEALED to a key the phrase derives (anyone
 * who sees an offer learns nothing of them); the enrolling device opens it with the phrase it types, picks, and the
 * ceremony hands each picked persona's chat identity, person key and delegation. The new device boots in delegation
 * custody and RUNS those personas — the same persona (same chat key) as on the phone, under its own wire id — and none
 * it was not handed. A device given no personas gets the default only.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { parseEnrollOffer, openOfferPersonas } from '../src/v2/enrollOffer.js';

const quickCircle = async (agent, id) => agent.callSkill('stoop', 'createGroupV2', { groupId: id, name: id, rules: { text: id } });

describe('enrol hands over the chosen personas', () => {
  it('the offer seals the persona list; the new device runs exactly the personas it picked, as the same persona', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const b = (await phone.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    await quickCircle(phone, 'thuis');
    const offer = await phone.callSkill('household', 'buildEnrollOffer', {});
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    // the offer itself names no persona in the clear
    expect(offer.uri.includes('Buurt') || offer.uri.includes(b), 'no persona in clear').toBe(false);
    expect(JSON.stringify(parseEnrollOffer(offer.uri)).includes('Buurt')).toBe(false);
    // the phrase opens the list
    const listed = openOfferPersonas(offer.uri, phrase);
    expect(listed.map((p) => p.id).sort()).toEqual([b, w].sort());
    expect(listed.find((p) => p.id === b)?.name).toBe('Buurt');
    // a wrong phrase opens nothing
    expect(openOfferPersonas(offer.uri, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')).toEqual([]);

    // the new device picks Buurt only
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'laptop', personas: [b] });
    expect(en.ok, JSON.stringify(en)).toBe(true);
    const laptop = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    const lb = laptop.persona(b);
    expect(lb, 'the laptop runs Buurt').toBeTruthy();
    expect(lb.chatId.pubKey, 'the SAME persona as on the phone').toBe(phone.persona(b).chatId.pubKey);
    expect(lb.enrolledDevice?.deviceId, 'under its own wire id').not.toBe(phone.persona(b).enrolledDevice?.deviceId);
    expect(laptop.persona(w), 'not Werk — it was not picked').toBeFalsy();
    // a delegated device still cannot MAKE a persona (that needs the phrase — a ceremony)
    const made = await laptop.callSkill('agents', 'createProfile', { name: 'Nieuw' });
    expect(made?.ok === true || typeof made?.id === 'string', `a persona was made without the phrase: ${JSON.stringify(made)}`).toBe(false);
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);

  it('a device given no personas runs the default only', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const b = (await phone.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'tablet' })).ok).toBe(true);
    const tablet = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    expect(tablet.persona(b)).toBeFalsy();
    expect(tablet.persona('default')).toBeTruthy();
    await phone.shutdown?.(); await tablet.shutdown?.();
  }, 120_000);
});
