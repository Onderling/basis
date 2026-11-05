/**
 * A PERSONA REMOVED FROM ONE DEVICE IS REVOKED ON THE PERSON'S OTHER DEVICES TOO — without a pod. The one-persona
 * ceremony's tombstone carries the revocation that persona's authority signed, so it travels on the device-map carry
 * and a third device (no pod, holding the old live record) takes it and stops counting the removed device as a sibling.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { deviceDelegationOf, setDeviceDelegation } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const boot = (d) => createRealHouseholdAgent({ seedHousehold: false, ...d });
const vaults = () => { const ownerRootVault = new VaultMemory(); return { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() }; };
async function enrolledWith(phrase, personas) {
  const v = vaults();
  const pre = await boot(v);
  const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas });
  if (!en.ok) throw new Error(JSON.stringify(en));
  await pre.shutdown?.();
  return { agent: await boot(v), v };
}
async function hold(agent, pid, rec) {
  const reg = agent.agentsRegistry();
  const entry = await reg.lookup(pid);
  await reg.register({ ...entry, properties: setDeviceDelegation(entry.properties ?? {}, rec.deviceId, rec) });
}

describe('a persona removed from one device: the tombstone travels', () => {
  it('the ceremony\'s tombstone reaches a third, pod-less device and revokes the removed device there', async () => {
    const phone = await boot(vaults());
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const { agent: laptop } = await enrolledWith(phrase, [w]);
    const { agent: C } = await enrolledWith(phrase, [w]);
    const lapRec = laptop.persona(w).enrolledDevice.record;
    const wire = lapRec.deviceId;
    await hold(C, w, lapRec);
    expect(deviceDelegationOf(await C.agentsRegistry().lookup(w), wire)?.revoked === true, 'C: live before').toBe(false);

    const r = await laptop.callSkill('household', 'removePersonaHere', { mnemonic: phrase, personaId: w });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const tomb = (await laptop.deviceRecordsOf(w))?.[wire];
    expect(tomb?.revoked, 'the laptop holds its tombstone').toBe(true);
    expect(typeof tomb?.revocation?.sig, 'the tombstone carries a signed revocation').toBe('string');

    await C.ownDeviceRecordsHandler(lapRec.pubKey, { subtype: C.ownDeviceRecordsSubtype, profileId: w, records: [tomb] });
    expect(deviceDelegationOf(await C.agentsRegistry().lookup(w), wire)?.revoked, 'C: the removed device is revoked').toBe(true);
    await phone.shutdown?.(); await laptop.shutdown?.(); await C.shutdown?.();
  }, 180_000);
});
