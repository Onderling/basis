/**
 * A DEVICE WITHOUT THE GENERAL PERSONA, at the sites that mean "the person" (not "this device speaks"): what the general
 * persona alone may say or do is skipped there — never done by the primary standing in for it. The add-a-device offer
 * names no circle in the clear (the clear part is the general persona's circles; a persona's would tie it to the person);
 * a persona-less contact card is the primary's own, asked as it.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { decodeContactCard } from '../src/v2/contactCardLink.js';
import { createRegistryPodMedium } from '../src/v2/registryCarrier.js';

function memoryPodSource(store = new Map()) {
  const notFound = () => Object.assign(new Error('not found'), { code: 'NOT_FOUND', status: 404 });
  return {
    store,
    async read(uri) { if (!store.has(uri)) throw notFound(); return { content: store.get(uri) }; },
    async write(uri, content) { store.set(uri, String(content)); return {}; },
    async delete(uri) { store.delete(uri); },
    async list() { return { entries: [...store.keys()] }; },
  };
}

async function werkOnlyLaptop({ registry = null } = {}) {
  const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
  const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
  const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
  const ownerRootVault = new VaultMemory();
  const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
  const chatVault = new VaultMemory();
  const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
  const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'werklaptop', personas: [w], withDefault: false });
  if (!en.ok) throw new Error(`enrol failed: ${JSON.stringify(en)}`);
  await pre.shutdown?.();
  const laptopRegistry = registry ?? createMemoryBackend();
  const laptop = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: laptopRegistry });
  const reboot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: laptopRegistry });
  return { phone, laptop, phrase, w, reboot };
}

describe('a device without the general persona, at the person-sites', () => {
  it('the add-a-device offer names no circle in the clear — Werk\'s circles are not the general persona\'s', async () => {
    const { phone, laptop } = await werkOnlyLaptop();
    await laptop.callSkill('stoop', 'createGroupV2', { groupId: 'werkoverleg', name: 'Werkoverleg', rules: { text: 'w' } });
    expect((await laptop.callSkill('stoop', 'listMyCircles', {}))?.circles, 'the laptop is in Werk\'s circle').toContain('werkoverleg');
    // it holds no general persona (so no circle in the clear) and no root (so no persona to seal): nothing to offer
    const offer = await laptop.callSkill('household', 'buildEnrollOffer', {});
    expect(offer?.ok).toBe(false);
    expect(offer?.error).toBe('no-circles');
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);

  it('a revoke on it does nothing in the general persona\'s name — above all, it never rotates the primary\'s person key with the general persona\'s seed', async () => {
    const { phone, laptop, phrase, w } = await werkOnlyLaptop();
    const before = laptop.persona(w).personKey;
    expect(before?.version, 'Werk has a person key').toBeTruthy();
    const r = await laptop.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'a-lost-device' });
    expect(r.outcome, JSON.stringify(r)).not.toBe('wrong-phrase');
    const after = laptop.persona(w).personKey;
    expect(after.version, 'Werk\'s key did not move (the lost device was never Werk\'s here)').toBe(before.version);
    expect(Buffer.from(after.seed).toString('hex')).toBe(Buffer.from(before.seed).toString('hex'));
    expect(r.personKeyVersion, 'no general-persona rotation reported').toBeUndefined();
    expect(((await laptop.callSkill('agents', 'listAgents', {}))?.items ?? []).map((x) => x.agentId), 'no general-persona row minted for the tombstone').not.toContain('default');
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);

  it('the replace ceremony — the general persona\'s devices, retired in its circles — is refused there, not half-done', async () => {
    const { phone, laptop, phrase, w } = await werkOnlyLaptop();
    const before = laptop.persona(w).personKey.version;
    const r = await laptop.callSkill('household', 'replaceDevice', { mnemonic: phrase });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('no-general-persona');
    expect(laptop.persona(w).personKey.version).toBe(before);
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);

  it('the general persona\'s row, brought by the person\'s pod, is not this device\'s: its circles are not reopened here', async () => {
    const pod = memoryPodSource();
    const viaPod = { provisionRegistryMedium: async (strategy) => createRegistryPodMedium({ podSource: pod, strategy }) };
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), ...viaPod });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    expect((await phone.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: 'thuis', handle: 'anna', address: 'relay:anna-thuis' }))?.ok).toBe(true);
    const ownerRootVault = new VaultMemory(); const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault }); const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w], withDefault: false })).ok).toBe(true);
    await pre.shutdown?.();
    const laptop = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend(), ...viaPod });
    expect(laptop.registryCarrierStatus(), 'the pod copy opened here (the recovery seal)').toMatchObject({ pulled: true });
    expect(((await laptop.callSkill('agents', 'listAgents', {}))?.items ?? []).map((r) => r.agentId), 'the general row came with the pod').toContain('default');
    const { reopened } = await laptop.reopenMemberCircles();
    expect(reopened, 'the general persona\'s circle is not reopened on a device without it').not.toContain('thuis');
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);

  it('a contact card asked with no persona is the primary\'s, never the general persona\'s', async () => {
    const { phone, laptop, w } = await werkOnlyLaptop();
    const card = await laptop.callSkill('stoop', 'getContactShareQr', {});
    const decoded = decodeContactCard(card?.payload);
    expect(decoded, 'a card was made').toBeTruthy();
    expect(decoded.webid, 'the card is Werk\'s').toBe(phone.persona(w).chatId.pubKey);
    expect(JSON.stringify(decoded).includes(phone.identity.chat.pubKey), 'nothing of the general persona on it').toBe(false);
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);
});
