/**
 * A REVOKE ROTATES THE PERSON KEY OF EVERY PERSONA THE LOST DEVICE HELD — on the device that runs the ceremony and runs
 * that persona. Anna's phone (root) holds her general self and persona W; her other device, which held W, is lost (its
 * line on the private device map, and its live root-signed record on W's row). The ceremony derives W's next person key
 * from W's own seed, keeps it and speaks as it, and says which version W went to. A persona the lost device never held
 * live (its record minted here, already revoked) is not rotated.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { Bootstrap, wireDeviceId, deriveDeviceSeed, signDeviceDelegation, deviceDelegationPubKey } from '@onderling/core';

const boot = (o) => createRealHouseholdAgent({ seedHousehold: false, deviceLog: new EventLog({ initial: [], muted: [] }), ...o });

async function cast({ lostHoldsW = true } = {}) {
  const phone = await boot({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
  const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
  const root = Bootstrap.fromMnemonic(phrase);
  const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
  // the lost device: its line on the private device map (as the own-devices sync carried it here)…
  const lostInternal = 'i-lost-0123456789';
  const lostWire = wireDeviceId(root.deriveAgentSeed('default'), lostInternal);
  await (await phone.ownStore()).put({ type: 'device-link', id: `device-link:${lostWire}`, wireId: lostWire, internalId: lostInternal }, { by: 'test' });
  // …and, when it held W, its LIVE record on W's row — the root-signed record an enrolment holding W writes (put in
  // place here through the profile's properties: the registry is per device in this harness, on the pod in production)
  if (lostHoldsW) {
    const wWire = wireDeviceId(root.deriveAgentSeed(w), lostInternal);
    const record = signDeviceDelegation(root.deriveProfileAuthority(w), { profileId: w, deviceId: wWire, pubKey: deviceDelegationPubKey(deriveDeviceSeed(root.deriveAgentSeed(w), wWire)) });
    const own = (await phone.deviceRecordsOf(w)) ?? {};
    expect((await phone.callSkill('agents', 'setProfileProperty', { id: w, key: 'deviceDelegations', value: { ...own, [wWire]: record } }))?.ok).toBe(true);
    expect((await phone.deviceRecordsOf(w))[wWire]?.revoked === true).toBe(false);
  }
  return { phone, phrase, w, lostWire };
}

describe("a persona's person key rotates when a device that held it is revoked", () => {
  it('W goes to v2 here — kept, spoken as, named in the outcome; the general self keeps its own key path', async () => {
    const { phone, phrase, w, lostWire } = await cast();
    const W = phone.persona(w);
    expect(W.personKey?.version).toBe(1);
    const wIdentityBefore = W.personIdentity?.pubKey;
    const r = await phone.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: lostWire, circleIds: [] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.personaKeyVersions, JSON.stringify(r)).toEqual({ [w]: 2 });
    expect(W.personKey.version).toBe(2);
    expect(W.personIdentity.pubKey, 'W now speaks as its new person key').not.toBe(wIdentityBefore);
    expect(r.personaKeysUndone ?? [], 'nothing left for another device').toEqual([]);
    await phone.shutdown?.();
  }, 150_000);

  it('a persona the lost device never held live is not rotated (its record is minted already revoked)', async () => {
    const { phone, phrase, w, lostWire } = await cast({ lostHoldsW: false });
    const r = await phone.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: lostWire, circleIds: [] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.personaKeyVersions ?? {}).toEqual({});
    expect(phone.persona(w).personKey.version).toBe(1);
    await phone.shutdown?.();
  }, 150_000);
});
