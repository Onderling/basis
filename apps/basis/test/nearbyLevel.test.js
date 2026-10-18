/**
 * WHAT THE NEARBY ROOM SEES OF A SELF — its LEVEL (none · handle · profile · full), set on THAT self's disclosure under
 * the reserved context `nearby` by ONE writer (`setNearbyLevel`) and read back by one reader (`nearbyLevelFrom`). It is
 * the person's, not the device's: it travels with the persona. Nothing set → `handle`, the floor (default-strict).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { createRegistryPodMedium } from '../src/v2/registryCarrier.js';
import { nearbyLevelFrom } from '../src/v2/nearbyLevel.js';

function memoryPodSource(store = new Map()) {
  const notFound = () => Object.assign(new Error('not found'), { code: 'NOT_FOUND', status: 404 });
  return { store, async read(u) { if (!store.has(u)) throw notFound(); return { content: store.get(u) }; }, async write(u, c) { store.set(u, String(c)); return {}; }, async delete(u) { store.delete(u); }, async list() { return { entries: [...store.keys()] }; } };
}
const levelOf = async (agent, id) => nearbyLevelFrom((await agent.callSkill('agents', 'getProfileDisclosure', { id }))?.disclosure);

describe('the Nearby level of a self', () => {
  it('nothing set is the floor; the one writer sets each level; the reader reads it back', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const w = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    expect(await levelOf(a, 'default'), 'default-strict: the floor').toBe('handle');
    for (const level of ['profile', 'none', 'handle', 'full']) {
      expect(await a.callSkill('household', 'setNearbyLevel', { personaId: w, level }), level).toMatchObject({ ok: true, level });
      expect(await levelOf(a, w), level).toBe(level);
    }
    expect(await levelOf(a, 'default'), 'another self is untouched').toBe('handle');
    expect((await a.callSkill('household', 'setNearbyLevel', { personaId: w, level: 'everything' }))?.ok).toBe(false);
    await a.shutdown?.();
  }, 120_000);

  it('the reserved context has ONE writer: the general disclosure op refuses `nearby`', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const r = await a.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: 'nearby', key: 'name', enabled: true });
    expect(r).toMatchObject({ ok: false, reason: 'reserved-context' });
    await a.shutdown?.();
  }, 60_000);

  it('it is the person\'s, not the device\'s: set on one device, read on the other', async () => {
    const pod = memoryPodSource();
    const viaPod = { provisionRegistryMedium: async (strategy) => createRegistryPodMedium({ podSource: pod, strategy }) };
    const owner = new VaultMemory();
    const one = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: owner, chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), ...viaPod });
    expect((await one.callSkill('household', 'setNearbyLevel', { personaId: 'default', level: 'profile' })).ok).toBe(true);
    await one.shutdown?.();
    // a second install of the same person (the same owner root), its own local registry, the same pod
    const two = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: owner, chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), ...viaPod });
    expect(await levelOf(two, 'default'), 'the level came with the person').toBe('profile');
    await two.shutdown?.();
  }, 120_000);
});

describe('the card prefill and the level', () => {
  it('the prefill for room self A reads only A\'s nearby release — nothing of B, never a marker key', async () => {
    const { createNearbyIdentity } = await import('../src/v2/nearbyIdentity.js');
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const w = (await a.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    expect((await a.callSkill('agents', 'setProfileProperty', { id: w, key: 'realName', value: 'Frits de Werker' }))?.ok, 'Werk has a real name').toBe(true);
    expect((await a.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Frits Thuis' }))?.ok).toBe(true);
    const callSkill = (app, op, args) => a.callSkill(app, op, args);
    const asWerk = createNearbyIdentity({ callSkill, roomSelf: () => ({ id: w, name: 'Werk' }) });
    expect(await asWerk.cardPrefill(), 'at the floor, no name is released').toEqual({});
    await a.callSkill('household', 'setNearbyLevel', { personaId: w, level: 'profile' });
    const pre = await asWerk.cardPrefill();
    expect(pre, 'Werk\'s own name').toEqual({ label: 'Frits de Werker' });
    expect(JSON.stringify(pre)).not.toContain('Thuis');
    const released = (await a.callSkill('agents', 'getPersonaRelease', { id: w, contextId: 'nearby' }))?.released ?? {};
    expect(Object.keys(released).filter((k) => k.startsWith('_')), 'no marker key is ever released').toEqual([]);
    await a.shutdown?.();
  }, 120_000);
});
