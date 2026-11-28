/**
 * THE POD BRINGS A RESTORED PHONE'S CIRCLES BACK, IN THE PHONE'S OWN ORDER. The phone walk (2026-11-28): wipe, the phrase
 * on the welcome, a first start NOT signed in, then a sign-in to the pod in place: no circle, not after 30 s, not after a
 * restart. The registry's pod mirror was attached only at boot (and only if signed in then), and once attached, its
 * last-write-wins kept the restored device's NEWER one-device copy over the pod's list.
 *
 * The rules (Fable, 2026-11-28): the mirror attaches when the session becomes ready, through the op the sign-in calls;
 * and a pod copy this device has not read is MERGED in (per circle), never written over by a clock.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { createRegistryPodMedium } from '../src/v2/registryCarrier.js';

function memoryPodSource(store = new Map()) {
  const notFound = () => Object.assign(new Error('not found'), { code: 'NOT_FOUND', status: 404 });
  return {
    store,
    async read(uri) { if (!store.has(uri)) throw notFound(); return { content: store.get(uri) }; },
    async write(uri, content) { store.set(uri, String(content)); return {}; },
    async delete(uri) { store.delete(uri); },
    async list() { return { entries: [...store.keys()] }; },
  };
}
const CIRCLE = 'circle-oosterpoort';
/** A shell whose pod session may not be ready: the medium is provided only while `session.on`. */
const boot = ({ vaults, podSource, backend, session }) => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: vaults.owner, chatVault: vaults.chat,
  registryBackend: backend,
  provisionRegistryMedium: async (strategy) => (session.on ? createRegistryPodMedium({ podSource, strategy }) : null),
});
const memberships = async (agent) => (await agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties?.circleMemberships?.value ?? {};

async function phoneWithACircleOnThePod() {
  const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
  const pod = memoryPodSource();
  const old = await boot({ vaults: anna, podSource: pod, backend: createMemoryBackend(), session: { on: true } });
  expect((await old.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-oosterpoort' }))?.ok).toBe(true);
  await old.shutdown?.();
  return { anna, pod };
}

describe('a restored phone gets its circles from the pod, signed in after its first start', () => {
  it('sign in IN PLACE, no restart: the circles are there', async () => {
    const { anna, pod } = await phoneWithACircleOnThePod();
    const session = { on: false };
    const phone = await boot({ vaults: anna, podSource: pod, backend: createMemoryBackend(), session });
    expect(Object.keys(await memberships(phone)), 'not signed in yet: nothing from the pod').not.toContain(CIRCLE);
    session.on = true;
    const r = await phone.callSkill('household', 'podSessionReady', {});
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect(Object.keys(await memberships(phone)), 'after the sign-in, in the same start').toContain(CIRCLE);
    await phone.shutdown?.();
  });

  it('the same door attaches the SETTINGS mirror after an in-place sign-in (it was attached only at boot too)', async () => {
    const { createSettingsPodMedium } = await import('../src/v2/settingsPodMedium.js');
    // composed as the shells compose it: a caching settings store the pod inner attaches to (`settingsPersistDb`)
    const { CachingDataSource } = await import('@onderling/local-store');
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const pod = memoryPodSource();
    const session = { on: false };
    const phone = await createRealHouseholdAgent({
      seedHousehold: false, seedDemoData: false,
      ownerRootVault: anna.owner, chatVault: anna.chat, registryBackend: createMemoryBackend(),
      settingsDataSource: new CachingDataSource(),
      provisionRegistryMedium: async (strategy) => (session.on ? createRegistryPodMedium({ podSource: pod, strategy }) : null),
      provisionSettingsMedium: async (strategy) => (session.on ? createSettingsPodMedium({ podSource: pod, podRoot: 'mem://pod/', strategy }) : null),
    });
    session.on = true;
    const r = await phone.callSkill('household', 'podSessionReady', {});
    expect(r).toMatchObject({ ok: true, settings: true, mode: 'cache' });
    const again = await phone.callSkill('household', 'podSessionReady', {});
    expect(again.settings, 'once attached, the door is a no-op').toBe(false);
    await phone.shutdown?.();
  });

  it('…and with a restart after the sign-in: the pod list is merged in, never written over', async () => {
    const { anna, pod } = await phoneWithACircleOnThePod();
    const backend = createMemoryBackend();
    const first = await boot({ vaults: anna, podSource: pod, backend, session: { on: false } });
    await first.shutdown?.();
    const phone = await boot({ vaults: anna, podSource: pod, backend, session: { on: true } });
    expect(Object.keys(await memberships(phone)), 'the restored device\'s newer local copy did not win').toContain(CIRCLE);
    await phone.shutdown?.();
    // and the pod still holds the circle (nothing pushed over it)
    const again = await boot({ vaults: anna, podSource: pod, backend: createMemoryBackend(), session: { on: true } });
    expect(Object.keys(await memberships(again))).toContain(CIRCLE);
    await again.shutdown?.();
  });
});
