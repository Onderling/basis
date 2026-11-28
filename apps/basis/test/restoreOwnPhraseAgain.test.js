/**
 * RESTORING A DEVICE FROM ITS OWN PHRASE. On a phone that already is this person, "Restore now" failed with the raw line
 * "VaultEncrypted: decryption failed for agent-stable-id" (a walk, 2026-11-27), while another person's phrase worked.
 * The vault's sentinel is bound to the ROOT's fingerprint: another phrase is another root, so the vault starts clean;
 * the same phrase keeps the sentinel, but the restore enrols a NEW device id and so seals under a NEW at-rest key, and
 * every entry sealed under the old one no longer opens. Those entries are unreadable either way; they go, the restore
 * stands, and what the restore wrote reads back.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { Bootstrap, AgentIdentity } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { restoreOwnerRoot, RESTORE_KEY_CHECK } from '../src/core/agent/ownerRootRestore.js';

describe('restoring a device from its own phrase', () => {
  it('a second restore with the same phrase on the same device succeeds', async () => {
    const PHRASE = Bootstrap.create().mnemonic;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const first = await restoreOwnerRoot({ mnemonic: PHRASE, rootKeyStore, chatVault, markerVault: ownerRootVault });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const again = await restoreOwnerRoot({ mnemonic: PHRASE, rootKeyStore, chatVault, markerVault: ownerRootVault });
    expect(again.ok, `the own phrase did not restore: ${JSON.stringify(again)}`).toBe(true);
    expect(again.deviceId, 'a restore enrols as a new device').not.toBe(first.deviceId);
  });

  it('through the app: its own phrase changes nothing (already you), and the next start boots on the same stores', async () => {
    // ruled 2026-11-28 (the phone walk: the full restore forgot the running self, circle and name gone): the phrase
    // this device already is is not restored through the app; restoreOwnerRoot above still restores it when called
    const ownerRootVault = new VaultMemory(); const chatVault = new VaultMemory(); const hostVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault });
    const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
    expect(mnemonic, 'the device shows its own phrase').toBeTruthy();
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic });
    expect(res, 'the own phrase through the app').toMatchObject({ ok: true, alreadyYou: true });
    let rebooted = null; let err = null;
    try { rebooted = await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault }); } catch (e) { err = e; }
    expect(err?.message ?? null, 'the next start did not boot').toBe(null);
    const expected = (await AgentIdentity.fromSeed(Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('default'), new VaultMemory())).pubKey;
    expect(rebooted.sa.agent.identity.pubKey, 'the same person after the restart').toBe(expected);
  });
});

describe('the first start after a restore deletes nothing on a key it has not proven', () => {
  it('restore pending, the key door answers a WRONG seed: nothing is deleted and the start says the key could not be read', async () => {
    const ownerRootVault = new VaultMemory(); const chatVault = new VaultMemory(); const hostVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault });
    // the restore itself (restoreOwnerRoot), with the device's own phrase: the app's op no longer restores that phrase
    // (it is already you), and this test is about a pending restore over the SAME root
    const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
    const pending = await restoreOwnerRoot({ mnemonic, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault, markerVault: ownerRootVault });
    expect(pending.ok, JSON.stringify(pending)).toBe(true);
    // the keystore answers differently at the next start (a half-done second restore, a storage fault)
    await new RootKeyStoreVault({ vault: ownerRootVault }).setSeed(crypto.getRandomValues(new Uint8Array(32)));
    const hostBefore = (await hostVault.list()).length; const chatBefore = (await chatVault.list()).length;
    let err = null;
    try { await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault }); } catch (e) { err = e; }
    expect(err?.message ?? '', 'the start went on with a key nothing proved').toMatch(/could not be read/i);
    expect((await hostVault.list()).length, 'the host vault lost entries').toBe(hostBefore);
    expect((await chatVault.list()).length, 'the chat vault lost entries').toBe(chatBefore);
  });
});

describe('the own phrase through the app leaves the device as it was', () => {
  it('no sealed entry goes, and the start after it boots on the same entries', async () => {
    const ownerRootVault = new VaultMemory(); const chatVault = new VaultMemory(); const hostVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault });
    const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
    const before = { host: (await hostVault.list()).sort(), chat: (await chatVault.list()).sort() };
    expect(await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic })).toMatchObject({ ok: true, alreadyYou: true });
    expect({ host: (await hostVault.list()).sort(), chat: (await chatVault.list()).sort() }).toEqual(before);
    await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault });
    expect((await chatVault.list()).sort(), 'the chat vault after the next start').toEqual(before.chat);
  });
});

describe('the key check is there whichever selves the device runs', () => {
  it('a restore on a device WITHOUT the general persona leaves the key check, and the start after it boots', async () => {
    const PHRASE = Bootstrap.create().mnemonic;
    const ownerRootVault = new VaultMemory(); const chatVault = new VaultMemory(); const hostVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const r = await restoreOwnerRoot({ mnemonic: PHRASE, rootKeyStore, chatVault, markerVault: ownerRootVault, withDefault: false, personas: ['p-0123456789ab'] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await chatVault.has(RESTORE_KEY_CHECK), 'the restore sealed its key check').toBe(true);
    let err = null;
    try { await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault }); } catch (e) { err = e; }
    expect(err?.message ?? null, 'a healthy restore without the general persona could not start').toBe(null);
  });
});
