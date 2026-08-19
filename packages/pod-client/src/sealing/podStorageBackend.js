// podStorageBackend.js — adapt a Solid pod (any PodClient-shaped client) to the BLIND `StorageBackend`
// port (@onderling/core): put/get/list over opaque ciphertext.
//
// This is the pod conformance for "storage is a free choice". The seal is applied ABOVE this adapter
// (the caller seals with `sealForAudience`, then puts the resulting ciphertext), so the pod stores an
// envelope it can never open — the pod's ACP/WAC becomes defence-in-depth on top of the seal, not the
// access mechanism. Point a circle's StorageBackend at a pod, a local in-memory store, or (a tail) an
// any-cloud bucket and the same sealed content moves unchanged and still opens only for a key-holder.
//
// PASS A PLAIN POD CLIENT. This adapter is deliberately blind — it neither seals nor opens; it moves the
// exact string it is handed. Do NOT wrap a `SealedPodClient` here: that would seal a second time (the
// seal already happened above, at the resolver). `SealedPodClient` is the OLDER, store-adjacent seal path
// (transparent seal-on-write / open-on-read) and is unchanged for its current callers; this port is the
// additive layering where the seal moves ABOVE a blind store. The two coexist.
//
// Mapping to the PodClient surface:
//   • put(ref, ciphertext) → inner.write(ref, ciphertext)   — the body is the opaque envelope string.
//   • get(ref)             → inner.read(ref, {decode:'string'}).content, or null on NOT_FOUND.
//   • list(prefix)         → inner.list(prefix) → the entry uris under that container/prefix.
// `decode:'string'` forces a TextDecoder pass so a `fp1:` envelope comes back as its exact string (see the
// same note in SealedPodClient) — the adapter returns ciphertext byte-for-byte, never a decoded body.

import { StorageBackend } from '@onderling/core';

/**
 * Wrap a PodClient-shaped client (read/write/list) as a blind `StorageBackend`. The returned object is a
 * `StorageBackend` instance (so it passes `assertStorageBackendConformance`) that forwards put/get/list to
 * the pod while treating every body as opaque ciphertext.
 *
 * @param {{read:Function, write:Function, list:Function}} podClient  a PLAIN pod client (NOT a SealedPodClient).
 * @param {object} [opts]
 * @param {(err:any)=>boolean} [opts.isNotFound]  classify a read error as "absent" → get() returns null.
 *   Defaults to `err?.code === 'NOT_FOUND'` (the PodClient / mapSourceCode convention).
 * @returns {StorageBackend}
 */
export function podStorageBackend(podClient, { isNotFound } = {}) {
  if (!podClient || typeof podClient.read !== 'function' || typeof podClient.write !== 'function' || typeof podClient.list !== 'function') {
    throw new Error('podStorageBackend: a PodClient with read/write/list is required');
  }
  const absent = typeof isNotFound === 'function' ? isNotFound : (err) => err?.code === 'NOT_FOUND';

  class PodStorageBackend extends StorageBackend {
    async put(ref, ciphertext) {
      // The body is the opaque ciphertext envelope — stringified defensively (a caller may hand a plain
      // string or a JSON-serialised tagged envelope; either way the pod stores exactly these bytes).
      await podClient.write(ref, String(ciphertext));
    }

    async get(ref) {
      try {
        const res = await podClient.read(ref, { decode: 'string' });
        // A PodClient read returns `{ content, ... }`; a bare-string client returns the string directly.
        const content = res && typeof res === 'object' && 'content' in res ? res.content : res;
        return content == null ? null : String(content);
      } catch (err) {
        if (absent(err)) return null;   // an absent ref is `null`, not a throw — matches the port contract.
        throw err;
      }
    }

    async list(prefix = '') {
      const entries = await podClient.list(prefix);
      // PodClient.list yields `[{ uri, ... }]`; a simpler client may yield bare ref strings.
      return (Array.isArray(entries) ? entries : []).map((e) => (e && typeof e === 'object' ? e.uri : e)).filter(Boolean);
    }
  }

  return new PodStorageBackend();
}
