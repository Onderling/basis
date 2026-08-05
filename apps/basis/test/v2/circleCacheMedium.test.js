// circleCacheMedium — a pod-backed circle's cache-mode store MEDIUM (cache-mode mirroring, slice 2b-core).
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
    const b = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'B', resolvePod });
    const rec = await b.read(URI);
    expect(rec?.bytes).toBe('device-A-note');
  });

  it('honest degrade: no pod (offline) → the write PARKS in the queue, nothing hits the pod', async () => {
    const pod = mockPod();
    const medium = createCircleCacheMedium({ localBackend: createMemoryBackend(), deviceId: 'A', resolvePod: async () => null });
    const res = await medium.write(URI, 'later');
    expect(res.queued).toBe(true);                         // parked for a later drain
    expect(pod.raw.size).toBe(0);                          // never written
    // reading it back locally still works (local-immediate write)
    expect((await medium.read(URI))?.bytes).toBe('later');
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
