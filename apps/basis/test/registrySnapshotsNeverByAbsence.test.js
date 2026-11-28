/**
 * THE POD'S CIRCLE SNAPSHOTS ARE NEVER REPLACED BY ABSENCE. At a restored device's first attach the merge writes the
 * merged list up, decorated with THIS device's snapshots, and at that moment it holds none of the circle's rows (the
 * landing comes after). Before this, the upload replaced the pod's snapshots with that empty set: a kill or a failed
 * landing in that window and the rows were gone from the only place that held them. Now the upload keeps the pod's
 * snapshot for every circle this device has nothing for (Fable, 2026-11-28: the same rule as the registry's merge).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry, setCircleMembership } from '@onderling/agent-registry';
import { settingsSealStrategyForIdentity } from '../src/v2/sharedCopyOpener.js';
import { createRegistryCarrier, createRegistryPodMedium, registryPodName } from '../src/v2/registryCarrier.js';

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
const RULES = { id: 'rules-1', type: 'group-rules', text: 'Solokring', source: { groupId: 'solo', rules: { name: 'Solokring' }, version: 1 } };

describe('the pod\'s circle snapshots are never replaced by absence', () => {
  it('a restored device\'s first upload (merge, before its landing) keeps the pod\'s rows for the circle', async () => {
    const identity = await AgentIdentity.fromSeed(new Uint8Array(32).fill(7), new VaultMemory());
    const pod = memoryPodSource();
    const medium = await createRegistryPodMedium({ podSource: pod, strategy: settingsSealStrategyForIdentity(identity) });
    const name = registryPodName(identity);
    // the old phone: its upload carries the circle's rules rows
    const old = createRegistryCarrier({ backend: createMemoryBackend(), deviceId: identity.pubKey, medium, name,
      decorateUpload: async (body) => ({ ...body, rosters: { solo: { rows: [], members: [], rules: [RULES] } } }) });
    await old.attach();
    await createAgentRegistry({ pseudoPod: old.pseudoPod, deviceId: identity.pubKey }).register({
      agentId: 'default', pubKey: 'p', agentUri: 'agent://p', role: 'profile',
      properties: setCircleMembership({}, 'solo', { handle: 'me', address: 'addr-solo' }),
    });
    // the restored device: a one-device list of its own, and NO rows yet (its upload's snapshot is empty)
    const backend = createMemoryBackend();
    const fresh = createRegistryCarrier({ backend, deviceId: identity.pubKey, medium: null, name: null,
      decorateUpload: async (body) => ({ ...body, rosters: {} }) });
    await createAgentRegistry({ pseudoPod: fresh.pseudoPod, deviceId: identity.pubKey }).register({
      agentId: 'default', pubKey: 'p', agentUri: 'agent://p', role: 'profile', properties: {},
    });
    const st = await fresh.attachMedium(medium, name);
    expect(st.merged).toBe(true);
    const onPod = JSON.parse(await medium.read(name));
    expect(onPod.rosters?.solo?.rules?.map((r) => r.id), 'the pod still holds the circle\'s rows after the merge\'s write').toEqual(['rules-1']);
    expect(fresh.podSnapshots()?.solo?.rules?.length, 'and the device still has them to land').toBe(1);
  });

  it('…but a circle the person LEFT takes its snapshot with it', async () => {
    const { removeCircleMembership } = await import('@onderling/agent-registry');
    const identity = await AgentIdentity.fromSeed(new Uint8Array(32).fill(8), new VaultMemory());
    const pod = memoryPodSource();
    const medium = await createRegistryPodMedium({ podSource: pod, strategy: settingsSealStrategyForIdentity(identity) });
    const name = registryPodName(identity);
    let withRows = true;
    const dev = createRegistryCarrier({ backend: createMemoryBackend(), deviceId: identity.pubKey, medium, name,
      decorateUpload: async (body) => ({ ...body, rosters: withRows ? { solo: { rows: [], members: [], rules: [RULES] } } : {} }) });
    await dev.attach();
    const reg = createAgentRegistry({ pseudoPod: dev.pseudoPod, deviceId: identity.pubKey });
    const joined = setCircleMembership({}, 'solo', { handle: 'me', address: 'addr-solo' });
    await reg.register({ agentId: 'default', pubKey: 'p', agentUri: 'agent://p', role: 'profile', properties: joined });
    expect(JSON.parse(await medium.read(name)).rosters?.solo).toBeTruthy();
    withRows = false;
    await reg.register({ agentId: 'default', pubKey: 'p', agentUri: 'agent://p', role: 'profile', properties: removeCircleMembership(joined, 'solo') });
    expect(JSON.parse(await medium.read(name)).rosters?.solo, 'the leave took the snapshot off the pod').toBeUndefined();
  });
});
