/**
 * ONE ADDRESS PER PERSONA PER CIRCLE. The per-circle keys (address, signing identity, sealing pair, commitment signer)
 * derive from the persona's circle root, not from the device: every FULL device of a persona presents the same address
 * in a circle, and a co-member sees one member, one address. The phrase re-derives it; a device enrolled without the
 * phrase was handed the root at enrol and derives the same one. Different personas, different circles: unlinkable.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const vaults = () => { const ownerRootVault = new VaultMemory(); return { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() }; };
const boot = (v) => createRealHouseholdAgent({ seedHousehold: false, ...v });
const addr = (agent, pid, circleId) => agent.persona(pid).circleAddressFor(circleId);

describe('one address per persona per circle', () => {
  it('two devices restored from the phrase present the same address in a circle', async () => {
    const a = await boot(vaults());
    const phrase = (await a.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const v = vaults();
    const pre = await boot(v);
    expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    await pre.shutdown?.();
    const b = await boot(v);
    expect(b.persona('default').enrolledDevice?.deviceId, 'two devices').not.toBe(a.persona('default').enrolledDevice?.deviceId);
    expect(addr(b, 'default', 'circle-x'), 'the same address').toBe(addr(a, 'default', 'circle-x'));
    expect(addr(a, 'default', 'circle-y'), 'another circle, another address').not.toBe(addr(a, 'default', 'circle-x'));
    await a.shutdown?.(); await b.shutdown?.();
  }, 120_000);

  it('a device enrolled without the phrase derives the same address as the phrase-holder; another persona does not', async () => {
    const a = await boot(vaults());
    const phrase = (await a.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const v = vaults();
    const pre = await boot(v);
    const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w] });
    expect(en.ok, JSON.stringify(en)).toBe(true);
    await pre.shutdown?.();
    const b = await boot(v);
    expect(addr(b, 'default', 'circle-x'), 'the general persona, same address').toBe(addr(a, 'default', 'circle-x'));
    expect(addr(b, w, 'circle-x'), 'Werk, same address').toBe(addr(a, w, 'circle-x'));
    expect(addr(a, w, 'circle-x'), 'two personas, two addresses').not.toBe(addr(a, 'default', 'circle-x'));
    await a.shutdown?.(); await b.shutdown?.();
  }, 120_000);
});
