/**
 * Stoop V2 — Phase 29 tests.
 *
 *   29.1  RevealsCache: round-trip; cold-boot hydration
 *   29.2  InterestProfileCache: debounced write; cold-boot hydration
 *   29.3  PushRegistryCache: round-trip; cold-boot hydration
 *   29.4  All three flush to a stubbed pod source on attachInner
 *         (the existing Phase 23.6 pattern, now covering more entities)
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import { update as updateInterest } from '../src/lib/InterestProfile.js';
import { RevealsCache, REVEALS_STORAGE_PATH } from '../src/lib/RevealsCache.js';
import { InterestProfileCache, INTEREST_PROFILE_STORAGE_PATH } from '../src/lib/InterestProfileCache.js';
import { PushRegistryCache, PUSH_REGISTRY_STORAGE_PATH } from '../src/lib/PushRegistryCache.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

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

async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'stoop-phase29-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function buildBundle({ persistPath } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
    persistPath,
  });
  await bundle.offeringMatch.start();
  return bundle;
}

/* ── 29.1 RevealsCache ─────────────────────────────────────── */

describe('Stoop V2 Phase 29.1 — RevealsCache', () => {
  it('Reveals mutations write through to mem://stoop/reveals.json', async () => {
    const bundle = await buildBundle();
    bundle.reveals.setPeerReveal(BOB, true);
    bundle.reveals.setGroupReveal('oosterpoort', true);

    // Settled — flush is sync from the event listener.  Read back via cache.
    const raw = await bundle.cache.read(REVEALS_STORAGE_PATH);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.peers.find(p => p.peerWebid === BOB)?.showDisplayName).toBe(true);
    expect(parsed.groups.find(g => g.groupId === 'oosterpoort')?.showDisplayName).toBe(true);
  });

  it('cold-boot bundle (same persistPath) hydrates Reveals from disk', async () => {
    const { dir, cleanup } = await makeTmpDir();
    try {
      const b1 = await buildBundle({ persistPath: dir });
      b1.reveals.setPeerReveal(BOB, true);
      // Allow FilePersist debounce.
      await new Promise(r => setTimeout(r, 250));

      const b2 = await buildBundle({ persistPath: dir });
      const decision = b2.reveals.decide({ peerWebid: BOB });
      expect(decision.showDisplayName).toBe(true);
    } finally { await cleanup(); }
  });
});

/* ── 29.2 InterestProfileCache ─────────────────────────────── */

describe('Stoop V2 Phase 29.2 — InterestProfileCache', () => {
  it('writes through after debounce window via flushNow', async () => {
    const bundle = await buildBundle();
    updateInterest(bundle.interestProfile, 'fiets band lekker plak');
    expect(bundle.interestProfileFlushNow).toBeTypeOf('function');
    bundle.interestProfileFlushNow();
    // The write goes via dataSource.write — synchronous-with-pending-promise.
    await new Promise(r => setTimeout(r, 10));
    const raw = await bundle.cache.read(INTEREST_PROFILE_STORAGE_PATH);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.totalDocs).toBe(1);
    expect(parsed.centroidTerm.fiets).toBeGreaterThan(0);
  });

  it('cold-boot bundle hydrates InterestProfile from disk', async () => {
    const { dir, cleanup } = await makeTmpDir();
    try {
      const b1 = await buildBundle({ persistPath: dir });
      updateInterest(b1.interestProfile, 'kun je mijn fiets repareren?');
      updateInterest(b1.interestProfile, 'fiets band');
      b1.interestProfileFlushNow();
      await new Promise(r => setTimeout(r, 250));

      const b2 = await buildBundle({ persistPath: dir });
      expect(b2.interestProfile.totalDocs).toBe(2);
      expect(b2.interestProfile.centroidTerm.fiets).toBeGreaterThanOrEqual(2);
    } finally { await cleanup(); }
  });

  it('debounces — multiple updates within window produce one save', async () => {
    let writes = 0;
    const tinyDataSource = {
      async read()  { return null; },
      async write() { writes += 1; },
      async delete() {},
      async list() { return []; },
    };
    const profile = await InterestProfileCache.load({ dataSource: tinyDataSource });
    const { detach, flushNow } = InterestProfileCache.attach({
      profile, dataSource: tinyDataSource, debounceMs: 50,
    });
    updateInterest(profile, 'a b c');
    updateInterest(profile, 'd e f');
    updateInterest(profile, 'g h i');
    expect(writes).toBe(0);                  // still pending
    flushNow();
    expect(writes).toBe(1);                  // 3 updates → 1 write
    detach();
  });
});

/* ── 29.3 PushRegistryCache ────────────────────────────────── */

describe('Stoop V2 Phase 29.3 — PushRegistryCache', () => {
  const SUB = Object.freeze({
    endpoint: 'https://push.example/sub/1',
    keys: { p256dh: 'aaa', auth: 'bbb' },
  });

  it('PushRegistry mutations write through', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB });
    // Allow the synchronous onChange callback to flush.
    await new Promise(r => setTimeout(r, 10));
    const raw = await bundle.cache.read(PUSH_REGISTRY_STORAGE_PATH);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed[ANNE]).toHaveLength(1);
    expect(parsed[ANNE][0].endpoint).toBe(SUB.endpoint);
  });

  it('cold-boot bundle hydrates PushRegistry from disk', async () => {
    const { dir, cleanup } = await makeTmpDir();
    try {
      const b1 = await buildBundle({ persistPath: dir });
      await callSkill(b1.agent, 'subscribeWebPush', { subscription: SUB });
      await new Promise(r => setTimeout(r, 250));

      const b2 = await buildBundle({ persistPath: dir });
      expect(b2.pushRegistry.list(ANNE)).toHaveLength(1);
      expect(b2.pushRegistry.list(ANNE)[0].endpoint).toBe(SUB.endpoint);
    } finally { await cleanup(); }
  });

  it('unsubscribe removes from disk too', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB });
    await new Promise(r => setTimeout(r, 10));
    await callSkill(bundle.agent, 'unsubscribeWebPush', { endpoint: SUB.endpoint });
    await new Promise(r => setTimeout(r, 10));
    const raw = await bundle.cache.read(PUSH_REGISTRY_STORAGE_PATH);
    const parsed = JSON.parse(raw);
    expect(parsed[ANNE]).toBeUndefined();
  });
});

/* ── 29.4 Pod-attach flush ─────────────────────────────────── */

describe('Stoop V2 Phase 29 — pod-attach flush carries Reveals + Push subs', () => {
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

    // Trigger writes for all three entities.  The cache.write paths
    // are fire-and-forget at the persist hook; await a tick so the
    // queued ops flush through to the stub.
    bundle.reveals.setPeerReveal(BOB, true);
    bundle.pushRegistry.add(ANNE, { endpoint: 'https://push.example/x', keys: {} });
    await new Promise(r => setTimeout(r, 50));

    const paths = writes.map(w => w.path);
    expect(paths.some(p => p === REVEALS_STORAGE_PATH)).toBe(true);
    expect(paths.some(p => p === PUSH_REGISTRY_STORAGE_PATH)).toBe(true);
  });
});
