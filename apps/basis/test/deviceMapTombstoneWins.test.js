/**
 * THE DEVICE MAP: A TOMBSTONE WINS, WHATEVER ARRIVES FIRST. The person's devices carry their device map to each other
 * (the sibling carry). A device holding an OLD live record of a device revoked since may carry it on — it must never
 * revive the revoked device. The tombstone carries the revocation the self's authority signed, so a receiver verifies
 * it; and a live record never overrides a tombstone already held (deny wins, as the roster fold).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { deviceDelegationOf } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const vaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
async function enrolled(phrase, label) {
  const v = vaults();
  const pre = await createRealHouseholdAgent({ seedHousehold: false, ...v });
  expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, label })).ok).toBe(true);
  await pre.dispose?.();
  return createRealHouseholdAgent({ seedHousehold: false, ...v });
}
const recOf = async (agent, deviceId) => deviceDelegationOf(await agent.agentsRegistry().lookup('default'), deviceId);
async function hold(agent, rec) {
  const reg = agent.agentsRegistry();
  const { setDeviceDelegation } = await import('@onderling/agent-registry');
  const entry = await reg.lookup('default');
  await reg.register({ ...entry, properties: setDeviceDelegation(entry.properties ?? {}, rec.deviceId, rec) });
}

describe('the device map: a tombstone wins, whatever arrives first', () => {
  let A; let B; let phrase; let bId; let live; let tomb;

  beforeAll(async () => {
    A = await createRealHouseholdAgent({ seedHousehold: false, ...vaults() });
    phrase = (await A.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    B = await enrolled(phrase, 'B');
    bId = B.persona('default').enrolledDevice.deviceId;
    live = B.persona('default').enrolledDevice.record;
    await hold(A, live);
    expect((await A.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: bId }))?.ok).toBe(true);
    tomb = await recOf(A, bId);
    expect(tomb?.revoked, 'A holds the tombstone').toBe(true);
  }, 180_000);

  /** C: a device of the person that knows A (its sibling) and, before anything is carried, B's live record. */
  async function deviceC() {
    const C = await enrolled(phrase, 'C');
    await hold(C, A.persona('default').enrolledDevice.record);
    return C;
  }
  const fromA = () => A.persona('default').enrolledDevice.record.pubKey;
  const carry = (C, records) => C.ownDeviceRecordsHandler(fromA(), { subtype: C.ownDeviceRecordsSubtype, profileId: 'default', records });

  it('the tombstone carries the authority\'s signed revocation', () => {
    expect(tomb.revocation?.deviceId).toBe(bId);
    expect(typeof tomb.revocation?.sig).toBe('string');
  });

  it('live first, then the tombstone: B ends revoked on C', async () => {
    const C = await deviceC();
    await hold(C, live);
    await carry(C, [tomb]);
    expect((await recOf(C, bId))?.revoked).toBe(true);
  }, 120_000);

  it('the tombstone first, then an old live record re-carried: B stays revoked on C', async () => {
    const C = await deviceC();
    await carry(C, [tomb]);
    expect((await recOf(C, bId))?.revoked, 'the tombstone landed').toBe(true);
    await carry(C, [live]);
    expect((await recOf(C, bId))?.revoked, 'the old live record did not revive B').toBe(true);
  }, 120_000);

  it('a sibling\'s device address is pinned as its own key while live, and unpinned once its tombstone lands', async () => {
    const C = await deviceC();
    await hold(C, live);
    const security = C.sa?.agent?.security;
    expect(security, 'the harness exposes the security layer').toBeTruthy();
    expect((await C.ownDeviceAddressesOf('default')), 'B is C\'s sibling').toContain(live.pubKey);
    expect(security.getPeerKey(live.pubKey), 'pinned: B\'s device address is its own key').toBe(live.pubKey);
    await carry(C, [tomb]);
    expect((await C.ownDeviceAddressesOf('default')), 'B is no sibling any more').not.toContain(live.pubKey);
    expect(security.getPeerKey(live.pubKey) ?? null, 'unpinned once revoked').toBeNull();
  }, 120_000);

  it('a tombstone whose revocation is not the authority\'s is not kept', async () => {
    const C = await deviceC();
    await hold(C, live);
    await carry(C, [{ ...tomb, revocation: { ...tomb.revocation, sig: 'AAAA' } }]);
    expect((await recOf(C, bId))?.revoked ?? false, 'a forged tombstone revokes nothing').toBe(false);
  }, 120_000);
});
