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
 * @returns {{read:Function, write:Function, delete:Function, list:Function, catchUp:Function, pseudoPod:object}}
 *          a core.DataSource-shaped medium (an adapter over the cache-mode PseudoPod) + `catchUp` + the pod.
 */
export function createCircleCacheMedium({ localBackend, deviceId, resolvePod, versioning } = {}) {
  if (!localBackend || typeof localBackend.get !== 'function') {
    throw new TypeError('createCircleCacheMedium: a localBackend (StorageBackend) is required');
  }
  if (typeof resolvePod !== 'function') {
    throw new TypeError('createCircleCacheMedium: resolvePod() => {backend,strategy}|null is required');
  }
  const pod = createPseudoPod({
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

  // The store expects a core.DataSource (`read` → the stored VALUE, `write(uri,value,{ifMatch})`), but a
  // PseudoPod's `read` returns a RICHER record `{uri, bytes, etag, _v}` and its `write` takes a bare etag. So
  // the medium is a thin ADAPTER over the PseudoPod — unwrap `read` to `.bytes`, map `write`'s options — not
  // the raw PseudoPod. (This is the DataSource-vs-PseudoPod shape difference; the methods match, the return
  // shapes don't.) `write` still returns the PseudoPod result so callers can see `{queued}` (honest degrade).
  const medium = {
    read:   async (uri) => { const rec = await pod.read(uri); return rec == null ? null : rec.bytes; },
    write:  async (uri, value, opts) => pod.write(uri, value, opts?.ifMatch),
    delete: async (uri) => (typeof pod.delete === 'function' ? pod.delete(uri) : undefined),
    list:   async (containerUri) => pod.list(containerUri),
    // Catch-up ENUMERATION. PseudoPod read-through is per-KEY and its `list` is local-only — so a fresh device
    // can OPEN a pod item it knows the id of, but never DISCOVERS items whose keys it has not seen. `catchUp`
    // closes that: list the circle's pod resources, then read each THROUGH (fetch + open + cache-local), so
    // the store's next `list()` (which reads the local backend fresh) finds them. Best-effort + idempotent (a
    // locally-present item is a cheap no-op read); a null pod / no key → nothing pulled (honest degrade).
    catchUp: async ({ prefix = '' } = {}) => {
      const c = await resolvePod();
      if (!c?.backend || (c.sealed && !c.strategy)) return { pulled: 0 };
      let pulled = 0;
      try {
        const uris = await c.backend.list(prefix);   // the per-circle pod backend is already circle-scoped
        for (const uri of (uris || [])) { if (await pod.read(uri)) pulled += 1; }
      } catch { /* best-effort — a partial catch-up still helps */ }
      return { pulled };
    },
    /** The underlying PseudoPod — for drain / introspection (the write-through queue lives on it). */
    get pseudoPod() { return pod; },
  };
  return medium;
}
