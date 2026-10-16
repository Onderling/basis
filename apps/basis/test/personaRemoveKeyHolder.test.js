/**
 * REMOVING THE KEY-HOLDER — the primary, whose delegation seed is this device's at-rest key. The device is first
 * RE-KEYED under the next held self: every sealed vault resealed under that self's delegation-derived key, the key door
 * and the custody marker moved to it; only then is the old primary removed (2a's steps). After a reboot everything opens
 * under the new primary, the old primary's slots are gone, and the phrase verifies against the new primary. The last
 * self is refused — that is retiring the device, the revoke ceremony.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { Bootstrap } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { readCustodyMode } from '../src/core/agent/ownerRootCustody.js';

const boot = (d) => createRealHouseholdAgent({ seedHousehold: false, ...d });

async function laptop({ withDefault = true } = {}) {
  const phone = await boot({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
  const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
  const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
  const ownerRootVault = new VaultMemory(); const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault }); const chatVault = new VaultMemory();
  const lap = { ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() };
  const pre = await boot(lap);
  const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w], withDefault });
  if (!en.ok) throw new Error(JSON.stringify(en));
  await pre.shutdown?.();
  return { phone, phrase, w, lap, agent: await boot(lap) };
}

describe('removing the key-holder', () => {
  it('re-keys under the next held self, then removes the old primary; a reboot opens everything under the new one', async () => {
    const { phone, phrase, w, lap, agent } = await laptop();
    const werkKey = phone.persona(w).chatId.pubKey;
    const r = await agent.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: 'default' });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, reloadRequired: true, rekeyedTo: w });
    await agent.shutdown?.();

    expect((await readCustodyMode(lap.ownerRootVault)).profileId, 'the marker moved to Werk').toBe(w);
    const again = await boot(lap);
    expect(again.persona('default'), 'the general persona is gone from this device').toBeFalsy();
    expect(again.identity.chat.pubKey, 'it speaks as Werk now').toBe(werkKey);
    expect(again.persona(w)?.chatId?.pubKey, 'Werk opens under the new key').toBe(werkKey);
    const keys = (await lap.chatVault.list?.()) ?? [];
    for (const slot of ['agent-privkey', 'person-key', 'device-delegation-seed']) expect(keys, `the general persona's ${slot} is gone`).not.toContain(slot);
    const other = Bootstrap.create().bootstrap.toMnemonic();
    expect((await again.callSkill('household', 'revokeDevice', { mnemonic: other, deviceId: 'nobody' })).outcome).toBe('wrong-phrase');
    expect((await again.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'nobody' })).outcome, 'the phrase verifies against the new primary').not.toBe('wrong-phrase');
    await phone.shutdown?.(); await again.shutdown?.();
  }, 150_000);

  it('a paused self is no next key-holder: removing the primary with only a paused one beside it is the last self', async () => {
    const { phone, phrase, w, agent } = await laptop();
    expect(await agent.callSkill('household', 'pausePersona', { personaId: w })).toMatchObject({ ok: true });
    expect(await agent.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: 'default' })).toMatchObject({ ok: false, error: 'last-self' });
    await phone.shutdown?.(); await agent.shutdown?.();
  }, 120_000);

  it('the last self cannot be removed — that is retiring the device', async () => {
    const { phone, phrase, w, agent } = await laptop({ withDefault: false });
    expect(await agent.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: w })).toMatchObject({ ok: false, error: 'last-self' });
    await phone.shutdown?.(); await agent.shutdown?.();
  }, 120_000);
});
