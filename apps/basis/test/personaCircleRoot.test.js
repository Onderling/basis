/**
 * THE PERSONA'S CIRCLE ROOT, HELD BUT NOT YET PRESENTED. Every per-circle key a persona will present derives from its
 * circle root at an epoch: the same on every full device of the persona — the phrase re-derives it, and a device enrolled
 * without the phrase is handed it at its ceremony. Until the switch, each device still presents its own address per
 * circle (nothing a co-member sees changes).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const vaults = () => { const ownerRootVault = new VaultMemory(); return { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() }; };
const boot = (v) => createRealHouseholdAgent({ seedHousehold: false, ...v });
const rootOf = (agent, pid) => {
  const r = agent.persona(pid).circleRoot;
  return r ? { epoch: r.epoch, seed: Buffer.from(r.seed).toString('hex') } : null;
};
const addr = (agent, pid, circleId) => agent.persona(pid).circleAddressFor(circleId);

describe('the persona\'s circle root', () => {
  it('two devices restored from the phrase hold the same circle root, epoch 0; their addresses are still their own', async () => {
    const a = await boot(vaults());
    const phrase = (await a.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const v = vaults();
    const pre = await boot(v);
    expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    await pre.shutdown?.();
    const b = await boot(v);
    expect(rootOf(a, 'default')?.epoch).toBe(0);
    expect(rootOf(b, 'default'), 'the same root').toEqual(rootOf(a, 'default'));
    expect(addr(b, 'default', 'circle-x'), 'not yet presented: each device its own address').not.toBe(addr(a, 'default', 'circle-x'));
    await a.shutdown?.(); await b.shutdown?.();
  }, 120_000);

  it('a device enrolled without the phrase is handed each persona\'s root; two personas, two roots', async () => {
    const a = await boot(vaults());
    const phrase = (await a.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const v = vaults();
    const pre = await boot(v);
    const en = await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w] });
    expect(en.ok, JSON.stringify(en)).toBe(true);
    await pre.shutdown?.();
    const b = await boot(v);
    expect(rootOf(b, 'default'), 'the general persona\'s root').toEqual(rootOf(a, 'default'));
    expect(rootOf(b, w), 'Werk\'s root').toEqual(rootOf(a, w));
    expect(rootOf(a, w)?.seed, 'two personas, two roots').not.toBe(rootOf(a, 'default')?.seed);
    await a.shutdown?.(); await b.shutdown?.();
  }, 120_000);
});
