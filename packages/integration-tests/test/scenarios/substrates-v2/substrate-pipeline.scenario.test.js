/**
 * Scenario: substrates-v2/substrate-pipeline
 *
 * The full V2 substrate stack wired together end-to-end. Proves the
 * substrates **compose** — unit tests already cover per-piece
 * behaviour; this scenario catches duck-typed-interface mismatches
 * before app adoption hits them.
 *
 * Pipeline under test:
 *
 *   pod-onboarding.provisionDefault
 *     → identity (BIP-39)
 *     → fake podProvisioner → {podUri, webidUri, fetch}
 *     → ACPs stamped, /private/, /sharing/, /sharing/public/ containers
 *     → storage-mapping + agent-registry seeded on the pseudo-pod mirror
 *     → WebID pointers patched
 *
 *   agent-registry.register
 *     → makeActorResolver → PolicyEngine.resolveActor bridges pubKey ↔ webid
 *
 *   pseudo-pod (cache mode, with isPodReachable wired to pod-routing)
 *     → write to https:// ref while reachable → uploads via mock podUploader
 *     → mark unreachable → write again → queues via write-through queue
 *     → mark reachable → drainWriteThroughQueue uploads pending entries
 *
 *   notify-envelope.publish
 *     → pseudo-pod:// ref → full-payload mode (receiver writeFromPeer)
 *     → https:// reachable ref → envelope-only
 *
 *   item-types.validateCanonical on the persisted shapes
 *
 *   item-store.treeOf walking dependencies + embeds, with the embed
 *     resolver wired through pseudo-pod.read
 *
 * The scenario uses real substrate code throughout — only the
 * pod-server interactions (createPod / putResource / etc.) and the
 * transport publish are mocked. The mocks are deliberately thin so
 * substrate↔substrate composition gets stressed.
 *
 * Standardisation: smoke test for Phases 52.1 – 52.13 + 51.x JS-side.
 */

import { describe, it, expect } from 'vitest';

import {
  AgentIdentity,
  PolicyEngine,
  generateMnemonic,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import {
  createPseudoPod,
  createMemoryBackend,
}                                          from '@onderling/pseudo-pod';
import { createPodRouting }                from '@onderling/pod-routing';
import { createNotifyEnvelope }            from '@onderling/notify-envelope';
import { validateCanonical }               from '@onderling/item-types';
import { ItemStore, treeOf }               from '@onderling/item-store';
import {
  createAgentRegistry,
  makeActorResolver,
}                                          from '@onderling/agent-registry';
import { provisionDefault }                from '@onderling/pod-onboarding';

const ANNE_POD    = 'https://anne.pod';
const ANNE_WEBID  = 'https://anne.pod/profile/card#me';
const DEVICE_ID   = 'laptop-anne';
const ANNE_AGENT  = 'agent://anne/laptop';

// ── Fake provisioner — records the calls + returns a stable pod URI ──────

function fakeProvisioner() {
  const calls = [];
  return {
    calls,
    async createPod(args) {
      calls.push({ name: 'createPod', args });
      return { podUri: ANNE_POD, webidUri: ANNE_WEBID, fetch: () => Promise.resolve() };
    },
    async createContainer(args) { calls.push({ name: 'createContainer', args }); },
    async setAcp(args)          { calls.push({ name: 'setAcp', args }); },
    async putResource(args)     { calls.push({ name: 'putResource', args }); },
    async patchWebidProfile(args) { calls.push({ name: 'patchWebidProfile', args }); },
  };
}

// ── In-memory "real pod" surrogate for cache mode write-through ──────────

function fakeRealPod() {
  /** @type {Map<string, {bytes: *, etag: string}>} */
  const store = new Map();
  let etagCounter = 0;
  const calls = [];
  return {
    store, calls,
    async fetcher(uri) {
      calls.push({ op: 'read', uri });
      return store.has(uri) ? { bytes: store.get(uri).bytes, etag: store.get(uri).etag } : null;
    },
    async uploader(uri, bytes /*, etag */) {
      calls.push({ op: 'write', uri });
      const etag = `"pod-${++etagCounter}"`;
      store.set(uri, { bytes, etag });
      return { etag };
    },
  };
}

// ── Tiny in-memory DataSource so we can use a real ItemStore ─────────────

function memoryDataSource() {
  const items = new Map();
  return {
    async read(uri)        { return items.has(uri) ? items.get(uri) : null; },
    async write(uri, body) { items.set(uri, body); return { etag: `mem-${items.size}` }; },
    async list(prefix)     { return [...items.keys()].filter(k => k.startsWith(prefix)).map(uri => ({ uri })); },
    async delete(uri)      { items.delete(uri); },
  };
}

describe('substrates-v2 substrate-pipeline — end-to-end composition', () => {
  it('provision → register → write (cache) → drain → validate → treeOf', async () => {
    // 1. Pseudo-pod + storage backend.
    const backend   = createMemoryBackend();
    const pseudoPod = createPseudoPod({
      backend, mode: 'standalone', deviceId: DEVICE_ID,
    });

    // 2. Pod-onboarding orchestrates the full provision flow.
    const provisioner = fakeProvisioner();
    const mnemonic = generateMnemonic();
    const provision = await provisionDefault({
      oidcProvider:    'https://inrupt.net',
      mnemonic,
      pseudoPod,
      podProvisioner:  provisioner,
      agentInfo: {
        deviceId:    DEVICE_ID,
        agentUri:    ANNE_AGENT,
        displayName: 'Anne (laptop)',
      },
    });
    expect(provision.podUri).toBe(ANNE_POD);
    expect(provision.webidUri).toBe(ANNE_WEBID);
    expect(provisioner.calls.map(c => c.name))
      .toContain('createContainer');
    expect(provisioner.calls.map(c => c.name))
      .toContain('patchWebidProfile');

    // Local mirror of the storage-mapping is present.
    const localMapping = await pseudoPod.read(
      `pseudo-pod://${DEVICE_ID}/private/storage-mapping`,
    );
    expect(localMapping?.bytes?.version).toBe(2);

    // 3. Pod-routing reads that mirror + drives reachability + circle policy.
    const podRouting = createPodRouting({
      pseudoPod,
      deviceId:     DEVICE_ID,
      anchorPodUri: ANNE_POD,
    });
    await podRouting.reload();
    expect(podRouting.resolve('sharing/tasks/abc'))
      .toBe('https://anne.pod/sharing/tasks/abc');

    // 4. Agent-registry registered with the same identity → ActorResolver.
    const registry = createAgentRegistry({
      pseudoPod, anchorPodUri: ANNE_POD, deviceId: DEVICE_ID,
    });
    const pubKeyB64 = Buffer.from(provision.identity.pubKey).toString('base64');
    await registry.register({
      agentId:      DEVICE_ID,
      pubKey:       pubKeyB64,
      webid:        ANNE_WEBID,
      agentUri:     ANNE_AGENT,
      role:         'device',
      name:         'Anne (laptop)',
      deviceId:     DEVICE_ID,
      capabilities: ['pinboard', 'tasks'],
    });
    // Sanity-check the registry has the entry we wrote.
    const allAgents = await registry.list();
    expect(allAgents).toHaveLength(1);
    expect(allAgents[0]).toMatchObject({
      agentId: DEVICE_ID,
      pubKey:  pubKeyB64,
      webid:   ANNE_WEBID,
    });

    const actorResolver = makeActorResolver(registry);

    // 5. PolicyEngine wired with the resolver — bridges pubKey ↔ webid.
    const policy = new PolicyEngine({
      trustRegistry:  null,
      skillRegistry:  null,
      agentPubKey:    pubKeyB64,
      actorResolver,
    });
    const byPub  = await policy.resolveActor(pubKeyB64);
    const byUri  = await policy.resolveActor(ANNE_AGENT);
    const byWeb  = await policy.resolveActor(ANNE_WEBID);
    expect(byPub?.webid).toBe(ANNE_WEBID);
    expect(byUri?.webid).toBe(ANNE_WEBID);
    expect(byWeb?.webid).toBe(ANNE_WEBID);
    expect(byUri?.pubKey).toBe(pubKeyB64);

    // 6. A cache-mode pseudo-pod against a "real pod" surrogate. Reaches
    //    via pod-routing's isPodReachable; writes go through the
    //    write-through queue when unreachable.
    const realPod = fakeRealPod();
    const cacheBackend = createMemoryBackend();
    const cachePod = createPseudoPod({
      backend:        cacheBackend,
      mode:           'cache',
      deviceId:       DEVICE_ID,
      podFetcher:     realPod.fetcher,
      podUploader:    realPod.uploader,
      isPodReachable: (uri) => podRouting.isPodReachable(uri),
    });

    // 6a. Online write → uploads via uploader, pod-assigned etag wins.
    const taskUri = 'https://anne.pod/sharing/tasks/abc.ttl';
    const w1 = await cachePod.write(taskUri, {
      type: 'task', id: 'task-abc', text: 'paint the fence',
      addedAt: Date.now(), addedBy: ANNE_AGENT,
    });
    expect(w1.queued).toBeUndefined();
    expect(w1.etag).toMatch(/^"pod-1"$/);
    expect(realPod.calls.filter(c => c.op === 'write')).toHaveLength(1);

    // 6b. Mark unreachable + write again → queues + skips upload.
    podRouting.markPodUnreachable(taskUri);
    expect(podRouting.isPodReachable(taskUri)).toBe(false);
    const w2 = await cachePod.write(taskUri, {
      type: 'task', id: 'task-abc', text: 'paint the fence (revised)',
      addedAt: Date.now(), addedBy: ANNE_AGENT,
    });
    expect(w2.queued).toBe(true);
    expect(await cachePod.writeThroughPendingCount()).toBe(1);
    expect(realPod.calls.filter(c => c.op === 'write')).toHaveLength(1);

    // 6c. Reconnect + drain. Queue empties, upload happens, pod etag
    //     overwrites the local one.
    podRouting.markPodReachable(taskUri);
    const drain = await cachePod.drainWriteThroughQueue();
    expect(drain.drained).toBe(1);
    expect(realPod.calls.filter(c => c.op === 'write')).toHaveLength(2);
    expect((await cachePod.read(taskUri))?.etag).toBe('"pod-2"');

    // 7. notify-envelope on the no-pod pseudo-pod with a fake transport.
    const sent = [];
    let inbound = null;
    const fakeTransport = {
      async publishEnvelope(env) { sent.push(env); },
      subscribeEnvelopes(cb)     { inbound = cb; return () => { inbound = null; }; },
    };
    const ne = createNotifyEnvelope({ transport: fakeTransport, pseudoPod, podRouting });
    ne.start();

    // pseudo-pod ref → full-payload regardless of reachability.
    // Persist the announcement locally first — `publish` is outbound
    // only; the local copy is what subscribers + tree-of embed walks
    // resolve against.
    const announcementUri = `pseudo-pod://${DEVICE_ID}/announcements/abc`;
    await pseudoPod.write(announcementUri, {
      type: 'announcement',
      body: 'expiring offer reminder',
    });
    await ne.publish({
      type:       'announcement',
      ref:        announcementUri,
      etag:       '"local-1"',
      payload:    { type: 'announcement', body: 'expiring offer reminder' },
      recipients: ['agent://bob'],
      fromActor:  ANNE_AGENT,
    });
    expect(sent[0].kind).toBe('announcement');
    expect(sent[0].payload).toBeTruthy();

    // https:// reachable → envelope-only (no payload).
    podRouting.markPodReachable();
    await ne.publish({
      type:       'task',
      ref:        taskUri,
      etag:       '"pod-2"',
      payload:    { type: 'task', text: 'paint' },
      recipients: ['agent://bob'],
      fromActor:  ANNE_AGENT,
    });
    expect(sent[1].kind).toBe('task');
    expect(sent[1].payload).toBeUndefined();
    expect(sent[1].ref).toBe(taskUri);

    // 7a. Receiver-side: deliver a full-payload envelope → writeFromPeer
    //     stores it locally → ne dispatches subscribers AFTER caching.
    //
    // The substrate intentionally doesn't `await` per-kind subscribers
    // (a slow subscriber shouldn't block the receive loop). The test
    // gates on a resolver that fires inside the subscriber so we wait
    // for the full pipeline before asserting.
    const tasksReceived = [];
    let resolveReceived;
    const receivedOnce = new Promise(r => { resolveReceived = r; });
    ne.subscribe({
      kind: 'announcement',
      callback: async (env) => {
        const local = await pseudoPod.read(env.ref);
        tasksReceived.push({ envRef: env.ref, localBytes: local?.bytes });
        resolveReceived();
      },
    });
    await inbound({
      v: 1,
      kind: 'announcement',
      ref:  `pseudo-pod://bob/announcements/x`,
      etag: '"bob-1"',
      payload: { type: 'announcement', body: 'hi from bob' },
      timestamp: new Date().toISOString(),
    });
    await receivedOnce;
    expect(tasksReceived).toHaveLength(1);
    expect(tasksReceived[0].localBytes).toEqual({ type: 'announcement', body: 'hi from bob' });

    // 8. item-types canonical validation across the persisted shapes.
    const validateRes = validateCanonical({
      type:        'task',
      id:          'task-abc',
      addedAt:     Date.now(),
      addedBy:     ANNE_AGENT,
      text:        'paint the fence',
    });
    expect(validateRes.ok).toBe(true);

    const announcementOk = validateCanonical({
      type:        'announcement',
      id:          'ann-1',
      addedAt:     Date.now(),
      addedBy:     ANNE_AGENT,
      text:        'expiring offer reminder',     // adapter copies text → body
    });
    expect(announcementOk.ok).toBe(true);

    // 9. item-store treeOf walking dependencies + embeds, with the embed
    //    resolver wired through the cache pseudo-pod's read path. Build a
    //    small DataSource-backed ItemStore for the local items.
    const ds = memoryDataSource();
    const store = new ItemStore({
      dataSource:    ds,
      rootContainer: 'mem://anne/',
    });
    const [parent] = await store.addItems(
      [{ type: 'task', text: 'paint house', notes: 'with subtasks + embed' }],
      { actor: ANNE_AGENT, actorDisplayName: 'Anne' },
    );
    const [child] = await store.addItems(
      [{ type: 'task', text: 'buy paint' }],
      { actor: ANNE_AGENT },
    );
    // Wire the embed + dependency by patching the parent body fields
    // directly through the dataSource (matches the substrate's
    // body-merge semantics; updateBody enforces RolePolicy gates).
    parent.dependencies = [child.id];
    parent.embeds = [
      { type: 'announcement', ref: `pseudo-pod://${DEVICE_ID}/announcements/abc` },
    ];
    await ds.write(`mem://anne/items/${parent.id}.json`, parent);

    const tree = await treeOf({
      rootId:  parent.id,
      getItem: async (id) => {
        const rec = await ds.read(`mem://anne/items/${id}.json`);
        return rec ?? null;
      },
      resolveExternalRef: async (ref) => {
        const rec = await pseudoPod.read(ref);
        if (!rec) return null;
        return { item: rec.bytes };
      },
    });
    expect(tree.id).toBe(parent.id);
    expect(tree.subtasks).toHaveLength(1);
    expect(tree.subtasks[0].id).toBe(child.id);
    expect(tree.embeds).toHaveLength(1);
    expect(tree.embeds[0].source).toBe('external');
    expect(tree.embeds[0].item).toMatchObject({ body: 'expiring offer reminder' });

    // 10. Cleanup.
    ne.stop();
  });

  it('identity-resolver consumes agent-registry as a MemberMap (52.11 path)', async () => {
    const pseudoPod = createPseudoPod({
      backend: createMemoryBackend(), mode: 'standalone', deviceId: DEVICE_ID,
    });
    const registry = createAgentRegistry({
      pseudoPod, anchorPodUri: ANNE_POD, deviceId: DEVICE_ID,
    });
    await registry.register({
      agentId:      DEVICE_ID,
      pubKey:       'pub-anne',
      webid:        ANNE_WEBID,
      agentUri:     ANNE_AGENT,
      role:         'device',
      name:         'Anne',
      deviceId:     DEVICE_ID,
      capabilities: ['pinboard'],
    });

    const { createAgentRegistryMemberMap } = await import('@onderling/identity-resolver');
    const memberMap = createAgentRegistryMemberMap(registry);
    const m = await memberMap.resolveByPubKey('pub-anne');
    expect(m).toMatchObject({
      webid:       ANNE_WEBID,
      pubKey:      'pub-anne',
      stableId:    DEVICE_ID,
      displayName: 'Anne',
      capabilities: ['pinboard'],
    });
  });
});
