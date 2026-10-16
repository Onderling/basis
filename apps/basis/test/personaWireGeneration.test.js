/**
 * A PERSONA HANDED AGAIN AFTER IT WAS REMOVED gets a NEW wire id on this device. The wire id is the persona's seed over the
 * device's internal id (generation 0); once a generation's record is tombstoned on the persona's row, the hand derives
 * the next (`${internalId}/1`, `/2`, …) — the first live or absent one. The old tombstone stays; nothing else is stored
 * (the blob and the device-map row carry the id as before). A device never re-handed keeps generation 0, unchanged.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { Bootstrap, wireDeviceId } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const boot = (d) => createRealHouseholdAgent({ seedHousehold: false, ...d });

describe('the wire id has a generation', () => {
  it('remove → re-hand: a new wire id, live on the row; the old tombstone stays; generation 0 was the first', async () => {
    const phone = await boot({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const ownerRootVault = new VaultMemory(); const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault }); const chatVault = new VaultMemory();
    const lap = { ownerRootVault, rootKeyStore, chatVault, registryBackend: createMemoryBackend() };
    const pre = await boot(lap);
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w] })).ok).toBe(true);
    await pre.shutdown?.();
    let laptop = await boot(lap);
    const internal = laptop.persona('default').internalDeviceId;
    const gen0 = laptop.persona(w).enrolledDevice.deviceId;
    expect(gen0, 'a device never re-handed: generation 0').toBe(wireDeviceId(Bootstrap.fromMnemonic(phrase).deriveAgentSeed(w), internal));

    expect((await laptop.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: w })).ok).toBe(true);
    await laptop.shutdown?.();
    laptop = await boot(lap);
    const back = await laptop.callSkill('household', 'receivePersonas', { mnemonic: phrase, personas: [w] });
    expect(back?.ok, JSON.stringify(back)).toBe(true);
    await laptop.shutdown?.();
    laptop = await boot(lap);
    const gen1 = laptop.persona(w)?.enrolledDevice?.deviceId;
    expect(gen1, 'handed again: it runs').toBeTruthy();
    expect(gen1, 'under a NEW wire id').not.toBe(gen0);
    expect(gen1).toBe(wireDeviceId(Bootstrap.fromMnemonic(phrase).deriveAgentSeed(w), `${internal}/1`));
    const recs = await laptop.deviceRecordsOf(w);
    expect(recs[gen0]?.revoked, 'the old tombstone stays').toBe(true);
    expect(recs[gen1], 'the new id is on the row').toBeTruthy();
    expect(recs[gen1].revoked === true, 'live').toBe(false);

    // a REVOKE after the re-hand (here, where the device map holds the rows) reads Werk's id from Werk's own row: it
    // tombstones the NEW id, and the old tombstone stays
    const generalWire = laptop.persona('default').enrolledDevice.deviceId;
    for (let i = 0; i < 40; i++) {   // the device-map rows are written just after boot
      const rows = ((await (await laptop.ownStore()).list?.()) ?? []).filter((it) => it?.type === 'device-link');
      if (rows.some((it) => it.wireId === gen1)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const rv = await laptop.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: generalWire });
    expect(rv?.revokedUnder?.[w], `the revoke names Werk's live id: ${JSON.stringify(rv)}`).toBe(gen1);
    const after = await laptop.deviceRecordsOf(w);
    expect(after[gen1]?.revoked, 'the new id is tombstoned').toBe(true);
    expect(after[gen0]?.revoked, 'the old tombstone stays').toBe(true);
    await phone.shutdown?.(); await laptop.shutdown?.();
  }, 150_000);
});
