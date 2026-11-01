/**
 * AN OFFER CARRIES ITS DEVICE OR IS NOT SHOWN. The offer introduces the new device to the one showing it through a part
 * sealed under the recovery seal; a device enrolled before the seal existed holds none, cannot fill that part, and says
 * so plainly instead of showing an offer whose new device could never meet it.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { enrollOfferErrorKey } from '../src/v2/enrollOffer.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const found = async (agent, cid) => {
  const st = createInitial();
  st.groupId = cid; st.name = cid; st.purpose = 't';
  return (await createSubmit({ state: st, callSkill: (a, o, x) => agent.callSkill(a, o, x) })).result;
};

describe('an offer carries its device or is not shown', () => {
  it('a device without the recovery seal refuses with its own reason; the shells word it', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await a.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const ownerRootVault = new VaultMemory();
    const v = { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ...v });
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase })).ok).toBe(true);
    await pre.shutdown?.();
    await v.chatVault.delete('recovery-seal-seed');   // enrolled before the seal existed
    const b = await createRealHouseholdAgent({ seedHousehold: false, ...v });
    expect(await found(b, 'kring-van-b'), 'b is in a circle').toBeTruthy();
    const built = await b.callSkill('household', 'buildEnrollOffer', {});
    expect(built, JSON.stringify(built)).toMatchObject({ ok: false, error: 'no-recovery-seal' });
    expect(enrollOfferErrorKey(built)).toBe('circle.enroll.offer_no_seal');
    expect(enrollOfferErrorKey({ ok: false, error: 'no-circles' })).toBe('circle.enroll.offer_error');
    await a.shutdown?.(); await b.shutdown?.();
  }, 120_000);
});
