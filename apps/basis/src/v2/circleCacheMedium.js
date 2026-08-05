// circleCacheMedium.js — a pod-backed circle's store MEDIUM: a cache-mode PseudoPod that write-throughs
// (sealed) to the circle's pod and reads-through (opened) on a local miss. "pod is truth, local cache is
// reality" (architecture.md) for a pod-backed circle — the runtime of `storeMode:'cache'`.
//
// It REUSES the battle-tested PseudoPod cache primitive wholesale (its write-through queue, offline drain,
// read-miss-through, restart-durability, Lamport conflict — all already tested in PseudoPod.cacheMode.test.js).
// This module adds only two thin things around it: (1) the per-resource SEAL — seal on upload, open on fetch,
// using the circle's live group-key strategy (slice-1 custody), so the pod never holds plaintext for a p2/p3
// circle; (2) the ASYNC pod-backend resolution — `resolvePod()` returns the circle's live
// `{ backend, sealed, strategy }` (or null when the pod is unreachable / no key), which lets the sync
// `getStore` build the medium immediately while the pod is resolved lazily per write/read.
//
// Honest degrade: `resolvePod()` → null (no pod, offline, or no group key) parks the write in the PseudoPod
// queue for a later drain — never a plaintext pod write, never a broken op. Pure of web/RN specifics: the
// platform supplies `localBackend` (persistent, for offline durability) + `resolvePod`.

import { createPseudoPod } from '@onderling/pseudo-pod';

const applySeal = (strategy, bytes) => (strategy?.seal ? strategy.seal(bytes) : bytes);
const applyOpen = (strategy, bytes) => (strategy?.open ? strategy.open(bytes) : bytes);

/**
 * @param {object} a
 * @param {import('@onderling/pseudo-pod').StorageBackend} a.localBackend  the local cache (persistent for
 *        the offline-durability guarantee; MemoryBackend in tests).
 * @param {string} a.deviceId
 * @param {() => Promise<{ backend:{put:Function,get:Function}, sealed:boolean, strategy:({seal:Function,open:Function}|null) }|null>} a.resolvePod
 *        the circle's live pod custody (slice-1 `resolveCirclePodCustody`), or null when unreachable / no key.
 * @param {object} [a.versioning]  optional displaced-bytes version store (pass-through to the PseudoPod).
 * @returns {import('@onderling/pseudo-pod').PseudoPod}  a DataSource-shaped ({read,write,delete,list}) medium.
 */
export function createCircleCacheMedium({ localBackend, deviceId, resolvePod, versioning } = {}) {
  if (!localBackend || typeof localBackend.get !== 'function') {
    throw new TypeError('createCircleCacheMedium: a localBackend (StorageBackend) is required');
  }
  if (typeof resolvePod !== 'function') {
    throw new TypeError('createCircleCacheMedium: resolvePod() => {backend,strategy}|null is required');
  }
  return createPseudoPod({
    backend: localBackend,
    mode:    'cache',
    deviceId,
    ...(versioning ? { versioning } : {}),
    // Reachability is decided by resolvePod (null ⇒ queue). Keep the up-front gate open; the real decision
    // (and the seal-or-refuse) is in the uploader, so a transient null still parks the write for drain.
    isPodReachable: () => true,
    podUploader: async (uri, bytes) => {
      const c = await resolvePod();
      if (!c?.backend) throw new Error('circle pod unreachable — parking write for drain');       // → queued (honest degrade)
      if (c.sealed && !c.strategy) throw new Error('sealed circle has no group key — refusing to write plaintext to the pod');
      await c.backend.put(uri, applySeal(c.strategy, bytes));
      return {};
    },
    podFetcher: async (uri) => {
      const c = await resolvePod();
      if (!c?.backend || (c.sealed && !c.strategy)) return null;   // no pod / can't open → treat as a local miss
      const raw = await c.backend.get(uri);
      if (raw == null) return null;
      return { bytes: applyOpen(c.strategy, raw) };
    },
  });
}
