/**
 * Pinboard V2 — Phase 29 tests.
 *
 *   29.3  PushRegistryCache: round-trip; cold-boot hydration
 *   29.4  All three flush to a stubbed pod source on attachInner
 *         (the existing Phase 23.6 pattern, now covering more entities)
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import { PUSH_REGISTRY_STORAGE_PATH } from '../src/lib/PushRegistryCache.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

/** A device-local medium, as a shell hands one: read/write by path, nothing else. */
function memoryMedium() {
  const m = new Map();
  return { m, async read(p) { return m.has(p) ? m.get(p) : null; }, async write(p, d) { m.set(p, d); } };
}

async function buildBundle({ pushStore } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
    pushStore,
  });
  await bundle.offeringMatch.start();
  return bundle;
}


/* ── 29.3 the push registry on its own device-local store ──── */

describe('the push registry lives on the device-local push store, never in the pinboard cache', () => {
  const SUB = Object.freeze({
    endpoint: 'https://push.example/sub/1',
    keys: { p256dh: 'aaa', auth: 'bbb' },
  });

  it('a subscription is written to the push store and not to the cache', async () => {
    const pushStore = memoryMedium();
    const bundle = await buildBundle({ pushStore });
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB });
    await new Promise(r => setTimeout(r, 10));
    const parsed = JSON.parse(await pushStore.read(PUSH_REGISTRY_STORAGE_PATH));
    expect(parsed[ANNE][0].endpoint).toBe(SUB.endpoint);
    expect(await bundle.cache.read(PUSH_REGISTRY_STORAGE_PATH)).toBeNull();
  });

  it('a cold boot over the same push store holds the subscription', async () => {
    const pushStore = memoryMedium();
    const b1 = await buildBundle({ pushStore });
    await callSkill(b1.agent, 'subscribeWebPush', { subscription: SUB });
    await new Promise(r => setTimeout(r, 10));
    const b2 = await buildBundle({ pushStore });
    expect(b2.pushRegistry.list(ANNE).map((x) => x.endpoint)).toEqual([SUB.endpoint]);
  });

  it('unsubscribe removes it from the push store too', async () => {
    const pushStore = memoryMedium();
    const bundle = await buildBundle({ pushStore });
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB });
    await callSkill(bundle.agent, 'unsubscribeWebPush', { endpoint: SUB.endpoint });
    await new Promise(r => setTimeout(r, 10));
    expect(JSON.parse(await pushStore.read(PUSH_REGISTRY_STORAGE_PATH))[ANNE]).toBeUndefined();
  });

  it('without a push store the registry is in memory only: the cache never holds it', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB });
    await new Promise(r => setTimeout(r, 10));
    expect(bundle.pushRegistry.list(ANNE)).toHaveLength(1);
    expect(await bundle.cache.read(PUSH_REGISTRY_STORAGE_PATH)).toBeNull();
  });
});

/* ── 29.4 Pod-attach flush ─────────────────────────────────── */

describe('Pinboard V2 Phase 29 — the pod-attach flush never carries a push subscription', () => {
  it('post-attach writes flow to a stubbed pod source', async () => {
    const bundle = await buildBundle();
    const writes = [];
    const stubPod = {
      async read()           { return null; },
      async write(path, data) { writes.push({ path, data }); },
      async delete()          {},
      async list()            { return []; },
    };
    await bundle.cache.attachInner(stubPod);

    // A member-map write does reach the pod; a push subscription never does. The cache.write paths are
    // fire-and-forget at the persist hook; await a tick so the queued ops flush through to the stub.
    await callSkill(bundle.agent, 'setMyDisplayName', { displayName: 'Anne' });
    bundle.pushRegistry.add(ANNE, { endpoint: 'https://push.example/x', keys: {} });
    await new Promise(r => setTimeout(r, 50));

    const paths = writes.map(w => w.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some(p => p === PUSH_REGISTRY_STORAGE_PATH)).toBe(false);
  });
});
