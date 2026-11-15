/**
 * podCache — platform-neutral wiring that routes a Folio `PodClient`'s
 * I/O through a cache-mode pseudo-pod (offline write-through queue +
 * read cache).
 *
 * Shared by BOTH Folio surfaces so the non-trivial podUploader /
 * podFetcher / adapter wiring lives in exactly one place:
 *   - desktop CLI: `src/cli/_podFactory.js` (supplies a NodeFsBackend)
 *   - mobile (RN): `apps/folio-mobile` (supplies the RN
 *     `@onderling/react-native/pseudo-pod-adapter` backend)
 *
 * ⚠️ This file MUST stay node:fs-free — folio-mobile bundles it via the
 * `@onderling-app/folio` platform-shell import (Hermes/RN, no Node). The
 * platform-specific *backend* is injected by the caller; only the
 * portable `@onderling/pseudo-pod` barrel is imported here (its Node
 * backend lives behind the separate `/node` subpath and is never
 * pulled in by this module).
 *
 * Phase B (desktop) + Phase C (mobile).
 */

import { createPseudoPod, createSyncEnginePodClient } from '@onderling/pseudo-pod';

/** Minimal content-type inference for the write-through (Folio v1 = .md). */
export function guessContentType(uri) {
  if (/\.md$/i.test(uri))   return 'text/markdown';
  if (/\.json$/i.test(uri)) return 'application/json';
  if (/\.txt$/i.test(uri))  return 'text/plain';
  return 'application/octet-stream';
}

/**
 * Wrap a real Folio PodClient in a cache-mode pseudo-pod + the
 * sync-engine adapter. The caller decides *whether* to call this (the
 * off-by-default flag) and supplies the platform `backend`.
 *
 * @param {object}  args
 * @param {object}  args.realPodClient  the underlying PodClient (mock or real).
 * @param {object}  args.backend        a `@onderling/pseudo-pod` StorageBackend
 *   (NodeFsBackend on desktop, RN createBackend on mobile, MemoryBackend
 *   for tests).
 * @param {string}  [args.deviceId='folio']  pseudo-pod local-namespace id.
 *   The data path keys on the full `https://` pod URI, not deviceId, so
 *   any stable string is fine.
 * @returns {object} a `podClient`-shaped object for `SyncEngine`.
 */
export function wrapWithPseudoPod({ realPodClient, backend, deviceId = 'folio' }) {
  if (!realPodClient) throw new Error('wrapWithPseudoPod: realPodClient required');
  if (!backend)       throw new Error('wrapWithPseudoPod: backend required');

  const pseudoPod = createPseudoPod({
    backend,
    mode:     'cache',
    deviceId,
    podFetcher: async (uri) => {
      try {
        const r = await realPodClient.read(uri, { decode: 'bytes' });
        return { bytes: r.content, ...(r.etag != null ? { etag: r.etag } : {}) };
      } catch (err) {
        if (err && err.code === 'NOT_FOUND') return null;
        throw err;
      }
    },
    podUploader: async (uri, bytes) => {
      // force:true — in cache mode the local store is canonical and the
      // write-through unconditionally overwrites the pod copy (mirrors
      // SyncEngine's own force-push intent; sidesteps an If-Match 412).
      await realPodClient.write(uri, bytes, {
        contentType: guessContentType(uri),
        force: true,
      });
      // No pod version back: a pod's PUT names none, and one read by a later request may be another writer's. The local
      // copy keeps its own version; the next fresh read takes the pod's ETag from the read's own response.
      return undefined;
    },
  });

  return createSyncEnginePodClient({ pseudoPod, podClient: realPodClient });
}
