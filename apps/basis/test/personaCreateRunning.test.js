/**
 * A persona, created, RUNS as its own identity on this device (persona arc c1 — no wire yet): its own chat identity
 * (from its own seed, in its own vault slot), its own device seed from its own wire device id, its own delegation
 * record signed by its own authority, its own per-circle keys. Nothing it holds is the default's, and nothing is the
 * root's. It comes back on the next boot with the same keys.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { Bootstrap, b64encode, verifyDeviceDelegation, deriveDeviceSeed, deriveCircleAddress } from '@onderling/core';
import { profilePubKey } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const CIRCLE = 'circle-two-personas';
const WIRE = /^d-[0-9a-f]{32}$/;
const pubB64 = (seed) => b64encode(nacl.sign.keyPair.fromSeed(seed).publicKey);
const boot = (v) => createRealHouseholdAgent({ seedHousehold: false, ...v });

describe('a created persona runs as its own identity (N = 2 on one device, no wire yet)', () => {
  it('its own chat identity, device id, delegation, authority and per-circle keys — none the default\'s, none the root\'s', async () => {
    const v = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const agent = await boot(v);
    const root = Bootstrap.fromMnemonic((await agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic);
    const made = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    expect(made.created).toBe(true);
    const id = made.id;
    const d = agent.persona('default');
    const b = agent.persona(id);
    expect(b, 'the persona runs').toBeTruthy();

    // its chat identity is the one its registry entry records, and not the default's
    expect(b.chatId.pubKey).toBe(profilePubKey(root, id));
    expect(b.chatId.pubKey).not.toBe(d.chatId.pubKey);
    // its own wire device id and device seed, from its own seed
    const rec = b.enrolledDevice.record;
    expect(rec.deviceId).toMatch(WIRE);
    expect(rec.deviceId).not.toBe(d.enrolledDevice.deviceId);
    expect(rec.pubKey).not.toBe(d.enrolledDevice.record.pubKey);
    expect(b.circleAddressFor(CIRCLE)).toBe(deriveCircleAddress(deriveDeviceSeed(root.deriveAgentSeed(id), rec.deviceId), CIRCLE));
    expect(b.circleAddressFor(CIRCLE)).not.toBe(d.circleAddressFor(CIRCLE));
    // nothing root-level, and not the default's authority
    expect(verifyDeviceDelegation(rec)).toBe(true);
    expect(rec.profileId).toBe(id);
    expect(rec.by).toBe(pubB64(root.deriveProfileAuthority(id)));
    expect(rec.by).not.toBe(d.enrolledDevice.record.by);
    expect(rec.by).not.toBe(pubB64(root.secret));
    expect(b.authorityPubKeyB64).toBe(rec.by);
    expect(b.ceremonyCommitmentFor(CIRCLE)).not.toBe(d.ceremonyCommitmentFor(CIRCLE));
    // its own person key
    expect(b.personKey?.version).toBe(1);
    expect(b.personKey.seed).not.toEqual(d.personKey.seed);
  }, 60_000);

  it('comes back on the next boot with the same keys', async () => {
    // the registry kept across boots, as every shell keeps it (without one it is memory, and a boot starts empty)
    const v = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const first = await boot(v);
    const { id } = await first.callSkill('agents', 'createProfile', { name: 'Werk' });
    const before = { chat: first.persona(id).chatId.pubKey, addr: first.persona(id).circleAddressFor(CIRCLE), dev: first.persona(id).enrolledDevice.deviceId };
    const again = await boot(v);
    const p = again.persona(id);
    expect(p, 'rebuilt at boot').toBeTruthy();
    expect(p.chatId.pubKey).toBe(before.chat);
    expect(p.circleAddressFor(CIRCLE)).toBe(before.addr);
    expect(p.enrolledDevice.deviceId).toBe(before.dev);
    // and the default is untouched by it
    expect(again.persona('default').chatId.pubKey).toBe(again.identity.chat.pubKey);
  }, 60_000);
});
