/**
 * A REVOKE FROM A DEVICE WITHOUT THE GENERAL PERSONA still TOMBSTONES the lost device under it: with the phrase in hand
 * the tombstone needs nothing else (the record is minted or flipped on the general persona's row, which a synced
 * registry brings). Only RETIRING it in the general persona's circles needs a member there — that part stays undone,
 * and the result says exactly that.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
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

describe('a revoke from a device without the general persona', () => {
  it('tombstones the lost device under the general persona too; only its circles are left undone', async () => {
    const pod = memoryPodSource();
    const viaPod = { provisionRegistryMedium: async (strategy) => createRegistryPodMedium({ podSource: pod, strategy }) };
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), ...viaPod });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const lostWire = phone.persona('default').enrolledDevice.deviceId;   // the phone, as the general persona knows it
    expect((await phone.deviceRecordsOf('default'))?.[lostWire], 'the phone is on the general persona\'s row').toBeTruthy();
    await phone.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: 'thuis', handle: 'a', address: 'x' });   // nudges the mirror

    const ownerRootVault = new VaultMemory(); const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault }); const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w], withDefault: false })).ok).toBe(true);
    await pre.shutdown?.();
    const laptop = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend(), ...viaPod });
    expect((await laptop.deviceRecordsOf('default'))?.[lostWire], 'the synced general row is readable here').toBeTruthy();

    const r = await laptop.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: lostWire });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await laptop.deviceRecordsOf('default'))?.[lostWire]?.revoked, 'tombstoned under the general persona').toBe(true);
    expect(r.outcome).toBe('partial');
    expect(r.undone, 'only the general circles are left').toEqual(['general-circles']);
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 150_000);
});
