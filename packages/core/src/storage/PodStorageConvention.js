/**
 * PodStorageConvention — small=inline, big=referenced helpers.
 *
 * Implements the convention specified in
 * `Design-v3/pod-client-api.md` §writeWithConvention / §readWithConvention.
 *
 *   writeWithConvention(podSource, externalStore, uri, content, opts)
 *   readWithConvention (podSource, externalStore, uri)
 *
 * Threshold semantics (locked 2026-04-28, Q-A.1):
 *
 *   - default `opts.threshold` is **1 MB** (1_000_000 bytes)
 *   - configurable per-call
 *   - `size <= threshold`  → inline write to the pod
 *   - `size  > threshold`  → upload to the configured `externalStore`,
 *                            write a reference-manifest JSON to the pod
 *
 * Default external store (locked 2026-04-28, Q-A.2):
 *
 *   - `NoneStore` — explicitly throws `EXTERNAL_STORE_NOT_CONFIGURED` when
 *      asked to put/get.  Apps must supply a real adapter to opt in to
 *      big-content handling.
 *
 * Errors raised here are plain `Error` instances with a `.code` field.
 * Track A5 maps these onto `ConventionError`:
 *
 *   - `EXTERNAL_STORE_NOT_CONFIGURED` — bubbled up from `NoneStore`
 *   - `INVALID_MANIFEST`              — bubbled up from `parseReferenceManifest`
 *   - `HASH_MISMATCH`                 — fetched bytes don't match the manifest's hash
 *
 * This module never imports from `@onderling/pod-client`; it sits in
 * `packages/core/src/storage/` so `core` consumers can use the helpers
 * directly without pulling in the full pod-client.
 */

import {
  hashContent,
  parseReferenceManifest,
  serializeReferenceManifest,
} from './reference-manifest.js';

import { NoneStore } from './external-stores/NoneStore.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

/* ─────────────────────────────────────────────────────────────────────────── */

// Parameter register (#36) — inline-vs-external storage threshold, 1 MB (scope:device, kind:internal).
export const DEFAULT_CONVENTION_THRESHOLD = param({ key: 'podStorageConvention.thresholdBytes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1_000_000 });

/** MIME type written to the pod when the payload is the manifest itself. */
const MANIFEST_CONTENT_TYPE = 'application/json';

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Decide a Content-Type for the inline write.  Heuristic:
 *
 *   - explicit `opts.contentType` always wins
 *   - plain string                       → `text/plain; charset=utf-8`
 *   - Uint8Array / Buffer / ArrayBuffer  → `application/octet-stream`
 *   - object (gets JSON.stringify'd)     → `application/json`
 *
 * @param {*} content
 * @param {object} [opts]
 * @returns {string}
 */
function inferContentType(content, opts = {}) {
  if (opts.contentType) return opts.contentType;
  if (typeof content === 'string') return 'text/plain; charset=utf-8';
  if (content instanceof Uint8Array) return 'application/octet-stream';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) return 'application/octet-stream';
  if (content instanceof ArrayBuffer) return 'application/octet-stream';
  if (content && typeof content === 'object') return 'application/json';
  return 'application/octet-stream';
}

/**
 * Normalize content into something we can hash, size, and pass to a
 * `DataSource.write`.  The convention layer is content-type-agnostic; we
 * only need a consistent byte view + a sensible payload-for-pod.
 *
 * Returns `{ bytes, payload, size, isObject }`:
 *   - `bytes`    — Uint8Array view used for hashing + sizing
 *   - `payload`  — what to hand to `podSource.write(uri, payload)` if we go
 *                  the inline path *or* what to upload to the external store
 *                  in the big-content path (same value either way)
 *   - `size`     — `bytes.byteLength`
 *   - `isObject` — true iff the caller passed a plain object/array we
 *                  serialized via `JSON.stringify`
 */
function normalize(content) {
  if (content === null || content === undefined) {
    throw conventionError(
      'writeWithConvention: content must not be null/undefined',
      'INVALID_ARGUMENT'
    );
  }

  if (typeof content === 'string') {
    const bytes = new TextEncoder().encode(content);
    return { bytes, payload: content, size: bytes.byteLength, isObject: false };
  }

  if (content instanceof Uint8Array) {
    return { bytes: content, payload: content, size: content.byteLength, isObject: false };
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) {
    const bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    return { bytes, payload: content, size: content.byteLength, isObject: false };
  }

  if (content instanceof ArrayBuffer) {
    const bytes = new Uint8Array(content);
    return { bytes, payload: bytes, size: bytes.byteLength, isObject: false };
  }

  if (typeof content === 'object') {
    const json  = JSON.stringify(content);
    const bytes = new TextEncoder().encode(json);
    return { bytes, payload: json, size: bytes.byteLength, isObject: true };
  }

  throw conventionError(
    `writeWithConvention: unsupported content type ${typeof content}`,
    'INVALID_ARGUMENT'
  );
}

function conventionError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Write `content` to the pod using the small=inline / big=referenced
 * convention.
 *
 * @param {object} podSource     — a `DataSource` exposing `read(uri)` /
 *                                  `write(uri, content, opts)` (e.g.
 *                                  `SolidPodSource`).
 * @param {object} externalStore — `ExternalStore` instance.  Default is
 *                                  `NoneStore` (throws on big content).
 * @param {string} uri           — pod URI to write to.
 * @param {string|Uint8Array|Buffer|ArrayBuffer|object} content
 * @param {object} [opts]
 * @param {number} [opts.threshold=1_000_000]   — bytes; size cutoff
 * @param {string} [opts.contentType]            — explicit Content-Type;
 *                                                 inferred otherwise
 * @returns {Promise<object>}                    — whatever `podSource.write`
 *                                                 returns, with our extra
 *                                                 `convention` field
 *                                                 (`'inline'` or
 *                                                 `'reference'`) tacked on.
 */
export async function writeWithConvention(
  podSource,
  externalStore = new NoneStore(),
  uri,
  content,
  opts = {}
) {
  if (!podSource || typeof podSource.write !== 'function') {
    throw conventionError(
      'writeWithConvention: podSource must implement write()',
      'INVALID_ARGUMENT'
    );
  }
  if (typeof uri !== 'string' || uri.length === 0) {
    throw conventionError(
      'writeWithConvention: uri must be a non-empty string',
      'INVALID_ARGUMENT'
    );
  }

  const threshold   = Number.isFinite(opts.threshold) && opts.threshold >= 0
    ? opts.threshold
    : DEFAULT_CONVENTION_THRESHOLD;
  const contentType = inferContentType(content, opts);
  const norm        = normalize(content);

  // ── Inline path ─────────────────────────────────────────────────────────
  if (norm.size <= threshold) {
    const result = await podSource.write(uri, norm.payload, { ...opts, contentType });
    return { ...(result || {}), convention: 'inline' };
  }

  // ── Reference path ──────────────────────────────────────────────────────
  // 1) Hash the content so the manifest commits to its bytes.
  const hash = hashContent(norm.bytes);

  // 2) Upload to the external store.  `NoneStore` throws here, surfacing
  //    `EXTERNAL_STORE_NOT_CONFIGURED` to the caller.
  const externalUri = await externalStore.put(norm.payload, { contentType, hash });
  if (typeof externalUri !== 'string' || externalUri.length === 0) {
    throw conventionError(
      'writeWithConvention: externalStore.put must return a non-empty URI string',
      'EXTERNAL_STORE_BAD_RESPONSE'
    );
  }

  // 3) Build + write the manifest.
  const manifest = {
    $type:       'external-reference',
    uri:         externalUri,
    contentType,
    size:        norm.size,
    hash,
  };
  const manifestJson = serializeReferenceManifest(manifest);

  const result = await podSource.write(uri, manifestJson, {
    ...opts,
    contentType: MANIFEST_CONTENT_TYPE,
  });

  return {
    ...(result || {}),
    convention: 'reference',
    manifest,
  };
}

/**
 * Read `uri` and transparently follow a reference manifest if present.
 *
 * Always returns the same shape `SolidPodSource.read` does, namely:
 *
 *   { content, contentType, lastModified, etag, size }
 *
 * For a reference-resolved read:
 *   - `content` is the bytes from the external store
 *   - `contentType` and `size` come from the manifest
 *   - `lastModified` and `etag` come from the pod resource (the manifest
 *     itself), since that's what conflict-detection needs to track
 *
 * On hash mismatch, throws `Error` with `.code = 'HASH_MISMATCH'`.
 *
 * @param {object} podSource
 * @param {object} externalStore
 * @param {string} uri
 * @returns {Promise<{
 *   content:      Uint8Array,
 *   contentType:  string,
 *   lastModified: string|null,
 *   etag:         string|null,
 *   size:         number,
 * }>}
 */
export async function readWithConvention(podSource, externalStore = new NoneStore(), uri) {
  if (!podSource || typeof podSource.read !== 'function') {
    throw conventionError(
      'readWithConvention: podSource must implement read()',
      'INVALID_ARGUMENT'
    );
  }
  if (typeof uri !== 'string' || uri.length === 0) {
    throw conventionError(
      'readWithConvention: uri must be a non-empty string',
      'INVALID_ARGUMENT'
    );
  }

  const result = await podSource.read(uri);

  // The pod resource was either the inline content itself or a manifest
  // pointing at the external store.  We recognize the manifest by its
  // `$type` marker; anything else is returned unchanged.
  if (!result || result.content === undefined || result.content === null) {
    return result;
  }

  // We use `parseReferenceManifest` directly (not `isReferenceManifest`) so
  // that content claiming to be a manifest but failing validation surfaces
  // INVALID_MANIFEST rather than being silently returned as bytes.
  // `parseReferenceManifest` returns `null` for content that isn't a
  // manifest at all (plain text, unrelated JSON), in which case we fall
  // through and return the pod result unchanged.
  let manifest;
  try {
    manifest = parseReferenceManifest(result.content);
  } catch (err) {
    // Malformed manifest — propagate.
    throw err;
  }
  if (manifest === null) {
    return result;
  }

  // Fetch the actual bytes via the external store.
  const fetched = await externalStore.get(manifest.uri);
  const bytes   = fetched instanceof Uint8Array
    ? fetched
    : (typeof Buffer !== 'undefined' && Buffer.isBuffer(fetched))
      ? new Uint8Array(fetched.buffer, fetched.byteOffset, fetched.byteLength)
      : null;
  if (!bytes) {
    throw conventionError(
      'readWithConvention: externalStore.get must return Uint8Array or Buffer',
      'EXTERNAL_STORE_BAD_RESPONSE'
    );
  }

  // Verify integrity.  Mismatch is hard-fail.
  const actualHash = hashContent(bytes);
  if (actualHash !== manifest.hash) {
    throw conventionError(
      `readWithConvention: hash mismatch — expected ${manifest.hash}, got ${actualHash}`,
      'HASH_MISMATCH'
    );
  }

  return {
    content:      bytes,
    contentType:  manifest.contentType,
    lastModified: result.lastModified ?? null,
    etag:         result.etag ?? null,
    size:         manifest.size,
  };
}
