/**
 * JOURNEYS 5 and 6 at the composition level (plan A1): the REAL agent factory, the registry riding its
 * carrier, a wipe modelled as a fresh local backend under the same identity.
 *
 *   5 — Anna is signed in; her phone is wiped; the new phone, with her phrase, finds its circles by itself.
 *       Asserted on the boot re-open loop naming her circle, from the pod, with nothing typed and no QR.
 *   6 — Someone else's install signed into Anna's pod without her phrase changes nothing on the pod.
 *
 * The pod is an in-memory SolidPodSource stand-in; the sealing, the carrier, the registry and the re-open
 * loop are the production modules.
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

const boot = ({ vaults, podSource, backend = createMemoryBackend(), onRegistryKeyMismatch }) => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: vaults.owner, chatVault: vaults.chat,
  registryBackend: backend,
  provisionRegistryMedium: async (strategy) => createRegistryPodMedium({ podSource, strategy }),
  onRegistryKeyMismatch,
});

describe('the registry rides the pod — journeys 5 and 6 through the real agent', () => {
  it('JOURNEY 5 — signed in, wiped, restored with the phrase: her circles come back by themselves', async () => {
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const pod = memoryPodSource();

    const phone = await boot({ vaults: anna, podSource: pod });
    expect(phone.registryCarrierStatus()).toMatchObject({ mode: 'cache', probe: 'missing' });
    const wrote = await phone.callSkill('agents', 'setProfileCircleMembership', {
      id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-oosterpoort',
    });
    expect(wrote?.ok).toBe(true);
    expect([...pod.store.values()].join(''), 'sealed at rest — the circle id is not on the pod in clear').not.toContain(CIRCLE);

    // ── WIPE ── a new phone: fresh local backend; the SAME owner-root vault stands for "she typed her
    // phrase" (the ceremony writes exactly this seed); same pod.
    const newPhone = await boot({ vaults: anna, podSource: pod });
    expect(newPhone.registryCarrierStatus()).toMatchObject({ mode: 'cache', probe: 'openable', pulled: true });
    const { reopened } = await newPhone.reopenMemberCircles();
    expect(reopened, 'the boot re-open loop found her circle on the pod').toContain(CIRCLE);
  });

  it('JOURNEY 6 — a second install without her phrase leaves the pod copy untouched and says why', async () => {
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const pod = memoryPodSource();
    const phone = await boot({ vaults: anna, podSource: pod });
    await phone.callSkill('agents', 'setProfileCircleMembership', {
      id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-oosterpoort',
    });
    const snapshot = new Map(pod.store);

    // A different person (fresh vaults → a different root) signed into the SAME pod. In life their
    // carrier would derive a different opaque name and simply see 'missing'; the seal is what protects
    // Anna's copy if the name were ever shared, so that is what this pins: point them at her resource.
    const [annaName] = [...pod.store.keys()];
    const theirPod = { ...pod, async write(uri, c) { return pod.write(uri, c); }, async read() { return pod.read(annaName); } };
    let mismatches = 0;
    const stranger = await boot({
      vaults: { owner: new VaultMemory(), chat: new VaultMemory() }, podSource: theirPod,
      onRegistryKeyMismatch: () => { mismatches += 1; },
    });
    expect(stranger.registryCarrierStatus()).toMatchObject({ mode: 'local', probe: 'undecryptable' });
    expect(mismatches, 'the shell was told').toBe(1);
    await stranger.callSkill('agents', 'setProfileCircleMembership', {
      id: 'default', circleId: 'their-circle', handle: 'x', address: 'relay:x',
    });
    expect(pod.store.get(annaName), "Anna's sealed registry is byte-for-byte what it was").toBe(snapshot.get(annaName));
    expect(pod.store.size, 'and nothing else landed on her pod').toBe(snapshot.size);
  });
});
