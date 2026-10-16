/**
 * A DEVICE WITHOUT THE GENERAL PERSONA: enrolling, the person may leave the general persona ('default') off a device — the
 * work laptop runs Werk only. Nothing of the general persona is then handed, derived, served or announced there: its
 * slots stay empty, the key door holds the PRIMARY's delegation seed (the device's first held self — "this device speaks
 * as"), and the custody marker names that self. 'default' keeps one meaning: the person's general persona — never "this
 * device". A marker naming a self the device does not hold refuses to boot as it (no fallback to anything).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { Bootstrap, deriveDeviceSeed } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { CUSTODY_MODE_KEY, readCustodyMode } from '../src/core/agent/ownerRootCustody.js';

const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]);

describe('a device without the general persona', () => {
  it('enrolled with Werk only, it runs Werk as its primary and holds nothing of the general persona', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;

    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'werklaptop', personas: [w], withDefault: false });
    expect(en.ok, JSON.stringify(en)).toBe(true);

    // the marker names the primary; the key door holds the PRIMARY's delegation seed, never the general persona's
    const custody = await readCustodyMode(ownerRootVault);
    expect(custody.mode).toBe('delegation');
    expect(custody.profileId).toBe(w);
    const root = Bootstrap.fromMnemonic(phrase);
    expect(sameBytes(await rootKeyStore.getSeed(), deriveDeviceSeed(root.deriveAgentSeed(w), custody.deviceId)), 'the door holds Werk\'s device seed').toBe(true);
    expect(sameBytes(await rootKeyStore.getSeed(), deriveDeviceSeed(root.deriveAgentSeed('default'), custody.deviceId))).toBe(false);
    // the general persona's slots (the bare names) were never written
    const keys = (await chatVault.list?.()) ?? [];
    for (const slot of ['agent-privkey', 'person-key', 'device-delegation-seed']) expect(keys, `no general-persona ${slot}`).not.toContain(slot);

    const laptopRegistry = createMemoryBackend();
    const laptop = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: laptopRegistry });
    expect(laptop.persona(w)?.chatId?.pubKey, 'Werk runs, the same persona as on the phone').toBe(phone.persona(w).chatId.pubKey);
    expect(laptop.persona('default'), 'the general persona does not run here').toBeFalsy();
    expect(laptop.identity.chat.pubKey, 'this device speaks as Werk').toBe(phone.persona(w).chatId.pubKey);
    // nothing of the general persona is WRITTEN for it either: on a fresh registry, no 'default' row can come from
    // anywhere but this device — so there must be none (it would carry Werk's key and Werk's device record)
    const listed = await laptop.callSkill('agents', 'listAgents', {});
    expect(Array.isArray(listed?.items), 'the registry was read').toBe(true);
    expect(listed.items.map((r) => r.agentId), 'Werk\'s own row is there').toContain(w);
    expect(listed.items.map((r) => r.agentId), 'no general-persona row made from this device').not.toContain('default');
    // a circle made here is the PRIMARY's: its self is Werk, it is filed under Werk, and still no general-persona row
    const made = await laptop.callSkill('stoop', 'createGroupV2', { groupId: 'werkoverleg', name: 'Werkoverleg', rules: { text: 'w' } });
    expect(made?.ok ?? true, JSON.stringify(made)).not.toBe(false);
    expect(laptop.circleSelf('werkoverleg')?.webid, 'the circle\'s self is Werk').toBe(phone.persona(w).chatId.pubKey);
    const after = (await laptop.callSkill('agents', 'listAgents', {}))?.items ?? [];
    expect(after.map((r) => r.agentId), 'joining wrote no general-persona row').not.toContain('default');
    // nothing of the general persona is served or carried: its sibling set is empty, its own lane is not ridden
    expect(await laptop.siblingDevicesOf('default')).toEqual([]);
    expect(await laptop.siblingDevicesOf(w)).toEqual(expect.any(Array));
    // the phrase is checked against the PRIMARY's delegation (the door's seed), not the general persona's
    const other = Bootstrap.create().bootstrap.toMnemonic();   // someone else's (valid) phrase
    expect((await laptop.callSkill('household', 'revokeDevice', { mnemonic: other, deviceId: 'nobody' })).outcome).toBe('wrong-phrase');
    expect((await laptop.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'nobody' })).outcome, 'the owner\'s phrase is the owner\'s').not.toBe('wrong-phrase');
    // …and stays Werk's after a reboot (the binding is read back from where the membership was filed)
    await laptop.shutdown?.();
    const again = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: laptopRegistry });
    expect(again.identity.chat.pubKey).toBe(phone.persona(w).chatId.pubKey);
    expect(again.circleSelf('werkoverleg')?.webid, 'still Werk\'s after a reboot').toBe(phone.persona(w).chatId.pubKey);
    expect(((await again.callSkill('agents', 'listAgents', {}))?.items ?? []).map((r) => r.agentId)).not.toContain('default');
    await phone.shutdown?.(); await pre.shutdown?.(); await again.shutdown?.();
  }, 120_000);

  it('a marker naming a self the device does not hold refuses to boot as it', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w], withDefault: false })).ok).toBe(true);
    const marker = JSON.parse(await ownerRootVault.get(CUSTODY_MODE_KEY));
    await ownerRootVault.set(CUSTODY_MODE_KEY, JSON.stringify({ ...marker, profileId: 'p-000000000000' }));
    await expect(createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() }))
      .rejects.toThrow(/does not hold/);
    await phone.shutdown?.(); await pre.shutdown?.();
  }, 120_000);

  it('a marker rewritten to name ANOTHER held self refuses to boot (the door\'s seed is not that self\'s delegation)', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const p = (await phone.callSkill('agents', 'createProfile', { name: 'Privé' })).id;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() });
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w, p], withDefault: false })).ok).toBe(true);
    const marker = JSON.parse(await ownerRootVault.get(CUSTODY_MODE_KEY));
    expect(marker.profileId).toBe(w);
    await ownerRootVault.set(CUSTODY_MODE_KEY, JSON.stringify({ ...marker, profileId: p }));   // held, but not the door's
    await expect(createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() }))
      .rejects.toThrow(/key door/);
    await phone.shutdown?.(); await pre.shutdown?.();
  }, 120_000);

  it('a device must hold at least one self: no general persona and none picked is refused, and nothing changes', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const before = await rootKeyStore.getSeed();
    const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [], withDefault: false });
    expect(en.ok).toBe(false);
    expect(en.error).toBe('no-persona');
    expect(sameBytes(await rootKeyStore.getSeed(), before), 'the key door is untouched').toBe(true);
    expect((await readCustodyMode(ownerRootVault)).mode).toBe('root');
    await phone.shutdown?.(); await pre.shutdown?.();
  }, 120_000);

  it('the general persona is still handed by default, and its marker names it', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault, rootKeyStore, chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase })).ok).toBe(true);
    expect((await readCustodyMode(ownerRootVault)).profileId).toBe('default');
    await phone.shutdown?.(); await pre.shutdown?.();
  }, 120_000);
});

