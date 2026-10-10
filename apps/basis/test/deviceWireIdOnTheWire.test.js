/**
 * A device's id ON THE WIRE is its persona-keyed wire id (`wireDeviceId(profileSeed, internalId)`), and its seed derives
 * from that id — so the record names nothing internal, and a revocation works from the record plus the phrase alone.
 * And a record minted before the persona's authority signed (its `by` is the root) is re-signed in place at the next
 * boot of a device that holds the root: same id, same key, same addresses — only the signer changes.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { VaultMemory, VaultEncrypted } from '@onderling/vault';
import {
  Bootstrap, deriveDeviceSeed, deviceDelegationPubKey, deriveCircleAddress, signDeviceDelegation, b64encode,
  firstDeviceIdFor, verifyDeviceDelegation,
} from '@onderling/core';
import { DEVICE_DELEGATIONS_KEY } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { DEVICE_DELEGATION_VAULT_KEY } from '../src/core/agent/ownerRootRestore.js';

const WIRE = /^d-[0-9a-f]{32}$/;
const CIRCLE = 'circle-wire-id';
const boot = (v) => createRealHouseholdAgent({ seedHousehold: false, ...v });
const fresh = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
const pubB64 = (seed) => b64encode(nacl.sign.keyPair.fromSeed(seed).publicKey);

async function records(agent) {
  const props = (await agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
  const map = props[DEVICE_DELEGATIONS_KEY]?.value ?? props[DEVICE_DELEGATIONS_KEY] ?? {};
  return Object.values(map).filter((r) => r && typeof r === 'object' && r.by);
}

describe('the wire device id', () => {
  it('the first device\'s record names a wire id, never its internal id, and its seed derives from it', async () => {
    const dev = await boot(fresh());
    const root = Bootstrap.fromMnemonic((await dev.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic);
    const [rec] = await records(dev);
    expect(rec.deviceId).toMatch(WIRE);
    expect(rec.deviceId).not.toBe(firstDeviceIdFor(root));
    const seed = deriveDeviceSeed(root.deriveAgentSeed('default'), rec.deviceId);
    expect(rec.pubKey).toBe(deviceDelegationPubKey(seed));
    expect(dev.circleAddressFor(CIRCLE)).toBe(deriveCircleAddress(seed, CIRCLE));
  }, 60_000);

  it('an enrolled device\'s record names a wire id, and the phrase + that id reproduce its seed', async () => {
    const dev1 = await boot(fresh());
    const phrase = (await dev1.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const v2 = fresh();
    const en = await (await boot(v2)).callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'twee' });
    expect(en.ok).toBe(true);
    expect(en.deviceId).toMatch(WIRE);
    const dev2 = await boot(v2);
    const seed = deriveDeviceSeed(Bootstrap.fromMnemonic(phrase).deriveAgentSeed('default'), en.deviceId);
    expect(dev2.circleAddressFor(CIRCLE)).toBe(deriveCircleAddress(seed, CIRCLE));
  }, 60_000);

  it('a stored record signed by the root is re-signed by the authority at boot — same id, same key, same address', async () => {
    const v = fresh();
    const dev = await boot(v);
    const root = Bootstrap.fromMnemonic((await dev.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic);
    const before = dev.circleAddressFor(CIRCLE);
    // Make the stored record what a device minted before this change holds: the same seed, signed by the ROOT.
    const sealed = new VaultEncrypted({ backing: v.chatVault, key: root.deriveVaultAtRestKey() });
    const blob = JSON.parse(await sealed.get(DEVICE_DELEGATION_VAULT_KEY));
    blob.record = signDeviceDelegation(root.secret, { profileId: 'default', deviceId: blob.deviceId, pubKey: blob.record.pubKey });
    await sealed.set(DEVICE_DELEGATION_VAULT_KEY, JSON.stringify(blob));
    expect(blob.record.by).toBe(pubB64(root.secret));

    const again = await boot(v);
    const healed = JSON.parse(await sealed.get(DEVICE_DELEGATION_VAULT_KEY));
    expect(healed.record.by, 're-signed by the authority').toBe(pubB64(root.deriveProfileAuthority('default')));
    expect(verifyDeviceDelegation(healed.record)).toBe(true);
    expect(healed.record.deviceId).toBe(blob.deviceId);
    expect(healed.record.pubKey).toBe(blob.record.pubKey);
    expect(again.circleAddressFor(CIRCLE), 'no address changes').toBe(before);
  }, 60_000);
});
