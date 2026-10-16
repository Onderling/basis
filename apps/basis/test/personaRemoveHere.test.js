/**
 * REMOVE A PERSONA FROM THIS DEVICE — a ceremony with the phrase, scoped to ONE persona: this device's delegation under
 * THAT persona is tombstoned (the general persona's and every other self's records untouched), its addresses in that
 * persona's circles are retired, its row on the private device map goes, and its keys, its circles' local content and
 * its place in the held list are wiped. Not undoable here. The primary (the key-holder) and a root-custody device are
 * refused; so is a paused persona (it must speak to retire its addresses — resume it first).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const boot = (d) => createRealHouseholdAgent({ seedHousehold: false, ...d });

async function laptopWithWerk() {
  const phone = await boot({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
  const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
  const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
  const ownerRootVault = new VaultMemory(); const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault }); const chatVault = new VaultMemory();
  const lap = { ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() };
  const pre = await boot(lap);
  const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w] });
  if (!en.ok) throw new Error(JSON.stringify(en));
  await pre.shutdown?.();
  const laptop = await boot(lap);
  return { phone, laptop, lap, phrase, w };
}
const delegationsOf = (agent, id) => agent.deviceRecordsOf(id);

describe('remove a persona from this device', () => {
  it('tombstones this device under that persona only, wipes its keys and its place here; a reboot does not run it', async () => {
    const { phone, laptop, lap, phrase, w } = await laptopWithWerk();
    const werkWire = laptop.persona(w).enrolledDevice.deviceId;
    const generalWire = laptop.persona('default').enrolledDevice.deviceId;
    // before: this device is on both records, live (the boot's heal wrote them)
    const werkBefore = (await delegationsOf(laptop, w))?.[werkWire];
    expect(werkBefore, 'on Werk\'s record').toBeTruthy();
    expect(werkBefore.revoked === true, 'live').toBe(false);
    expect((await delegationsOf(laptop, 'default'))?.[generalWire], 'on the general persona\'s record').toBeTruthy();
    const links = async () => ((await (await laptop.ownStore()).list?.()) ?? []).filter((it) => it?.type === 'device-link').map((it) => it.wireId);
    for (let i = 0; i < 40 && !(await links()).includes(werkWire); i++) await new Promise((res) => setTimeout(res, 100));   // written just after boot
    expect(await links(), 'Werk\'s device-map row before').toContain(werkWire);
    const r = await laptop.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: w });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, reloadRequired: true, personaId: w, deviceId: werkWire });
    expect(await links(), 'Werk\'s device-map row is gone').not.toContain(werkWire);
    const werkRecs = await delegationsOf(laptop, w);
    const generalRecs = await delegationsOf(laptop, 'default');
    expect(werkRecs?.[werkWire]?.revoked, 'this device, under Werk: tombstoned').toBe(true);
    expect(generalRecs?.[generalWire], 'still on the general persona\'s record').toBeTruthy();
    expect(generalRecs[generalWire].revoked === true, 'under the general persona: untouched').toBe(false);
    await laptop.shutdown?.();

    const again = await boot(lap);
    expect(again.persona(w), 'Werk does not run here any more').toBeFalsy();
    expect(((await again.callSkill('household', 'listPersonasHere', {}))?.personas ?? []).map((p) => p.id), 'not held here').not.toContain(w);
    const keys = (await lap.chatVault.list?.()) ?? [];
    for (const slot of ['agent-privkey', 'person-key', 'device-delegation-seed']) expect(keys, `Werk's ${slot} wiped`).not.toContain(`${slot}:${w}`);
    expect(again.persona('default'), 'the general persona still runs').toBeTruthy();
    await phone.shutdown?.(); await again.shutdown?.();
  }, 120_000);

  it('FAILS CLOSED: a tombstone that cannot be written stops the ceremony — nothing retired, nothing wiped, a retry possible', async () => {
    const { phone, laptop, lap, phrase, w } = await laptopWithWerk();
    const werkWire = laptop.persona(w).enrolledDevice.deviceId;
    const linkRows = async (a) => ((await (await a.ownStore()).list?.()) ?? []).filter((it) => it?.type === 'device-link').map((it) => it.wireId).sort();
    let own = [];
    for (let i = 0; i < 40 && !own.includes(werkWire); i++) { own = await linkRows(laptop); if (!own.includes(werkWire)) await new Promise((r) => setTimeout(r, 100)); }   // written just after boot
    expect(own, 'Werk\'s device-map row is there before').toContain(werkWire);
    // the registry's medium refuses every write from here on
    lap.registryBackend.put = async () => { throw new Error('the medium is gone'); };
    const r = await laptop.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: w });
    expect(r).toMatchObject({ ok: false, error: 'storage' });
    const keys = (await lap.chatVault.list?.()) ?? [];
    for (const slot of ['agent-privkey', 'person-key', 'device-delegation-seed']) expect(keys, `Werk's ${slot} kept`).toContain(`${slot}:${w}`);
    expect(((await laptop.callSkill('household', 'listPersonasHere', {}))?.personas ?? []).map((p) => p.id), 'still held').toContain(w);
    expect(laptop.persona(w)?.enrolledDevice?.deviceId, 'Werk still runs here, as before').toBe(werkWire);
    expect(await linkRows(laptop), 'the device-map row stays').toEqual(own);
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);

  it('refuses a wrong phrase, a paused persona, and a root-custody device', async () => {
    const { phone, laptop, phrase, w } = await laptopWithWerk();
    // (the primary — the key-holder — is removable since part 2b: personaRemoveKeyHolder.test.js)
    expect((await laptop.callSkill('household', 'removePersonaHere', { mnemonic: 'x y z', personaId: w })).ok).toBe(false);
    expect(await laptop.callSkill('household', 'pausePersona', { personaId: w })).toMatchObject({ ok: true });
    // still running this boot (a pause takes the next) — but marked paused: removal asks for a resume first
    expect(await laptop.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: w })).toMatchObject({ ok: false, error: 'paused' });
    const pw = (await phone.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    expect(await phone.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: pw })).toMatchObject({ ok: false, error: 'root-custody' });
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 120_000);
});
