// circleCacheMedium — a pod-backed circle's cache-mode store MEDIUM (cache-mode mirroring).
// Proves the two thin things the module adds around the (already-tested) PseudoPod cache primitive: the
// per-resource SEAL (seal on write-through, open on read-through) and the honest degrade (no pod / no key →
// parked, never a plaintext pod write). The medium-level round-trip (write on A → sealed on the pod → open on
// a fresh B) is the store-level analog of the two-device fan test; catch-up ENUMERATION (list-through) is a
// separate slice (3), so this asserts per-resource read-through, not list discovery.
import { describe, it, expect } from 'vitest';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createCircleCacheMedium } from '../../src/v2/circleCacheMedium.js';

// A mock circle pod: a StorageBackend (put/get/list), plus a visible seal so we can assert ciphertext.
function mockPod() {
  const store = new Map();
  const backend = {
    put: async (uri, v) => { store.set(uri, v); },
    get: async (uri) => (store.has(uri) ? store.get(uri) : null),
    list: async (prefix = '') => [...store.keys()].filter((k) => k.startsWith(prefix)),
  };
  const strategy = { seal: (s) => `SEALED(${s})`, open: (s) => String(s).replace(/^SEALED\((.*)\)$/, '$1') };
  return { backend, strategy, raw: store };
}
const registry = { validate: (it) => (['task', 'note'].includes(it.type) ? { ok: true } : { ok: false, errors: [{ message: 'bad type' }] }) };
const URI = 'mem://circles/c1/items/x1';

describe('createCircleCacheMedium — construction', () => {
  it('throws without a localBackend or resolvePod', () => {
    expect(() => createCircleCacheMedium({ resolvePod: async () => null })).toThrow(/localBackend/);
    expect(() => createCircleCacheMedium({ localBackend: createMemoryBackend() })).toThrow(/resolvePod/);
  });
});

describe('createCircleCacheMedium — sealed write-through / read-through', () => {
  it('a write SEALS then write-throughs to the pod; the pod never holds plaintext', async () => {
    const pod = mockPod();
    const medium = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'A', resolvePod: async () => ({ backend: pod.backend, sealed: true, strategy: pod.strategy }) });
    const res = await medium.write(URI, 'hello');
    expect(res.queued).toBeUndefined();                    // pod reachable → not parked
    expect(await pod.backend.get(URI)).toBe('SEALED(hello)');   // ciphertext on the pod, never 'hello'
  });

  it('a FRESH device opens the item by reading through the pod (A writes → pod → B opens)', async () => {
    const pod = mockPod();
    const resolvePod = async () => ({ backend: pod.backend, sealed: true, strategy: pod.strategy });
    const a = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'A', resolvePod });
    await a.write(URI, 'device-A-note');

    // Device B: a fresh LOCAL cache, same pod → local miss → read-through → OPENED plaintext.
    // (The medium is a core.DataSource adapter: `read` returns the VALUE, not the PseudoPod's {bytes} record.)
    const b = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'B', resolvePod });
    expect(await b.read(URI)).toBe('device-A-note');
  });

  it('honest degrade: no pod (offline) → the write PARKS in the queue, nothing hits the pod', async () => {
    const pod = mockPod();
    const medium = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'A', resolvePod: async () => null });
    const res = await medium.write(URI, 'later');
    expect(res.queued).toBe(true);                         // parked for a later drain
    expect(pod.raw.size).toBe(0);                          // never written
    // reading it back locally still works (local-immediate write)
    expect(await medium.read(URI)).toBe('later');
  });

  it('a SEALED circle with NO group key REFUSES the pod write (parks, never plaintext)', async () => {
    const pod = mockPod();
    const medium = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'A', resolvePod: async () => ({ backend: pod.backend, sealed: true, strategy: null }) });
    const res = await medium.write(URI, 'secret');
    expect(res.queued).toBe(true);                         // podUploader threw → parked
    expect(pod.raw.size).toBe(0);                          // NO plaintext on the pod
  });
});

describe('createCircleCacheMedium — as a circle store medium (via createCircleStores.dataSourceFor)', () => {
  it("a pod-backed circle's store writes flow through the cache medium to the pod, sealed", async () => {
    const pod = mockPod();
    const medium = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'A', resolvePod: async () => ({ backend: pod.backend, sealed: true, strategy: pod.strategy }) });
    const stores = createCircleStores({
      dataSource: memoryDataSource(), registry,
      dataSourceFor: (id) => (id === 'pod-circle' ? medium : null),
    });
    await stores.getStore('pod-circle').put({ type: 'task', text: 'buy milk' });

    // The circle's item landed on the pod as CIPHERTEXT (sealed), under its container.
    const podKeys = await pod.backend.list('mem://circles/pod-circle/');
    expect(podKeys.length).toBeGreaterThan(0);
    for (const k of podKeys) expect(await pod.backend.get(k)).toMatch(/^SEALED\(/);
  });
});

describe('createCircleCacheMedium — catch-up enumeration (a fresh device DISCOVERS pod items)', () => {
  it('a fresh device sees nothing until catchUp, then lists everything the pod holds', async () => {
    const pod = mockPod();
    const resolvePod = async () => ({ backend: pod.backend, sealed: true, strategy: pod.strategy });

    // Device A writes two items to the pod-backed circle.
    const mediumA = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'A', resolvePod });
    const a = createCircleStores({ dataSource: memoryDataSource(), registry, dataSourceFor: () => mediumA });
    await a.getStore('c1').put({ type: 'task', text: 'one' });
    await a.getStore('c1').put({ type: 'task', text: 'two' });

    // Device B: a FRESH local cache, same pod. It has no local keys → list() finds nothing (the gap).
    const mediumB = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'B', resolvePod });
    const b = createCircleStores({ dataSource: memoryDataSource(), registry, dataSourceFor: () => mediumB });
    expect(await b.getStore('c1').list()).toHaveLength(0);        // read-through per-key can't help — B has no ids

    // Catch-up enumerates the pod + reads each through → the store's next list() discovers them.
    const { pulled } = await mediumB.catchUp();
    expect(pulled).toBe(2);
    const items = await b.getStore('c1').list();
    expect(items.map((i) => i.text).sort()).toEqual(['one', 'two']);
  });

  it('catchUp is a no-op honest-degrade when the pod is unreachable', async () => {
    const medium = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'B', resolvePod: async () => null });
    expect(await medium.catchUp()).toEqual({ pulled: 0 });
  });
});
