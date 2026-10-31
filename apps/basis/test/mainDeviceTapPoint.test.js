/**
 * "MAKE THIS MY MAIN DEVICE" sets both: where direct messages land, and the POINT that signs the person's spine. A device
 * without the persona's circle root (enrolled before it existed) signs with its own key and cannot be the point: the tap
 * still moves the direct messages, refuses the point, and says why.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { makePrimaryResultWords } from '../src/v2/circleAddressAnnounce.js';

const vaults = () => { const ownerRootVault = new VaultMemory(); return { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() }; };
const boot = (v) => createRealHouseholdAgent({ seedHousehold: false, ...v });

describe('the main-device tap and the point', () => {
  it('a device with the circle root becomes both; one without it takes the direct messages only, and is told why', async () => {
    const a = await boot(vaults());
    const phrase = (await a.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const full = await a.claimPrimaryDevice();
    expect(full?.ok, JSON.stringify(full)).toBe(true);
    expect(full.point?.ok, 'the root device is the point too').toBe(true);
    expect(makePrimaryResultWords({ announced: 2, device: full }).key).toBe('circle.mydata.make_primary_done');

    const v = vaults();
    const pre = await boot(v);
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase })).ok).toBe(true);
    await pre.shutdown?.();
    const mid = await boot(v);
    await mid.persona('default').vault.set('circle-root', '');   // enrolled before the circle root existed
    await mid.shutdown?.();
    const box = await boot(v);
    expect(box.persona('default').circleRoot ?? null, 'no circle root on this device').toBeNull();
    const r = await box.claimPrimaryDevice();
    expect(r?.ok, 'the direct messages still move').toBe(true);
    expect(r.point).toEqual({ ok: false, reason: 'no-circle-root' });
    expect(box.spinePointClaim(), 'it did not become the point').toBeNull();
    const w = makePrimaryResultWords({ announced: 1, device: r });
    expect(w).toEqual({ key: 'circle.mydata.make_primary_no_point', params: { count: 1 } });
    await a.shutdown?.(); await box.shutdown?.();
  }, 120_000);
});
