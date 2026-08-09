/**
 * PodClient — high-level pod read/write/list/append/patch on top of
 * `SolidPodSource` and an `Auth` impl.
 *
 * @see Design-v3/pod-client-api.md §API surface
 *
 * Typical use:
 *   const client = new PodClient({ podRoot, auth });
 *   const { content } = await client.read('/notes/today.md', { decode: 'string' });
 *   await client.write('/notes/today.md', updated, { contentType: 'text/markdown' });
 *
 * Auth choices (from `@onderling/pod-client/Auth`):
 *   - `CapabilityAuth` — apps holding a `PodCapabilityToken` from the user's agent.
 *   - `SolidOidcAuth`  — the user's agent itself, wrapping a `SolidVault` session.
 *
 * Conflict detection (per-resource etag map) is populated here; A7 hangs the
 * 'conflict' event + retry policies off the same map.  In v1 we surface
 * `ConflictError` on 412 from the pod and let the caller handle.
 *
 * **No auto-sync.**  The SDK is on-demand by design.  The pod is the source
 * of truth; this client reads, writes, lists, deletes — but it does NOT
 * crawl the pod or maintain a background mirror.  Apps decide what to fetch
 * and when.
 *
 * **Tombstones (`deleteLocal`) are the per-device exception path within
 * whatever the app has chosen to sync.**  When you call `deleteLocal(uri)`,
 * the pod is untouched; a tombstone is recorded in the `tombstoneStore` so
 * that subsequent `client.list()` calls hide that URI on this device, and
 * any app-level sync routine the app builds can skip it.  Use
 * `clearTombstone(uri)` to undo a `deleteLocal`.  Use `deleteCompletely(uri)`
 * (or its alias `delete(uri)`) to remove from the pod for everyone — that
 * also drops any local tombstone (it is no longer relevant).
 *
 * The default `tombstoneStore` is `MemoryTombstones` (non-persistent).
 * Production apps should pass a platform-appropriate adapter:
 *   - Web:  `IndexedDBTombstones`
 *   - RN:   `AsyncStorageTombstones`
 *   - Node: `FileTombstones`
 */
import { Emitter } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
// SolidPodSource was extracted OUT of @onderling/core into this package (Phase 1/3
// pod-storage extraction); import it from its local module here rather than
// from the kernel, which no longer exports it. (Completes a dangling import
// left by that extraction; `./SolidPodSource.js` is the same module this
// package re-exports from its own index.)
import { SolidPodSource } from './SolidPodSource.js';

import { ConflictError, mapSourceCode } from './Errors.js';
import { ConflictResolver }             from './ConflictResolver.js';
import { MemoryTombstones }             from './tombstones/MemoryTombstones.js';
import { createClientSharing }          from './sharing/index.js';

// Inrupt's RDF API is loaded lazily inside `patch()` — pod-client itself does
// not declare `@inrupt/solid-client` as a direct dep; we resolve it via the
// transitive install in `@onderling/core/node_modules/`.  This keeps pod-client
// lean for callers that never patch.
let _inrupt = null;
async function loadInrupt() {
  if (_inrupt) return _inrupt;
  _inrupt = await import('@inrupt/solid-client');
  return _inrupt;
}

// Parameter register (#36) — append retries + conflict-listener timeout (scope:device, kind:internal).
const DEFAULT_APPEND_RETRIES         = param({ key: 'podClient.appendRetries', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
const DEFAULT_CONFLICT_POLICY        = 'reject';   // Q-A.4 LOCK 2026-04-28
const DEFAULT_CONFLICT_LISTENER_TIMEOUT_MS = param({ key: 'podClient.conflictListenerTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });
// Soft cap for fetching `remoteContent` to attach to the 'conflict' event.
// Above this size, or for non-text content types, `remoteContent` is left
// undefined and the listener can decide what to do (re-fetch via client.read,
// merge by URI, etc.).  This bound also protects against runaway memory use.
// Parameter register (#36) — soft cap for remoteContent fetch (scope:device, kind:internal).
const REMOTE_CONTENT_FETCH_LIMIT     = param({ key: 'podClient.remoteContentFetchLimit', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1_000_000 });
const TEXT_CONTENT_TYPE_RE           = /^(text\/|application\/json\b|application\/.*\+json\b)/i;

/**
 * High-level pod client: read/write/list/append/patch/delete on top of `SolidPodSource` plus an
 * `Auth` implementation (`CapabilityAuth` or `SolidOidcAuth`). On-demand by design — no background
 * sync or pod crawling. Tracks per-resource etags and, on an HTTP 412 write conflict, emits a
 * `'conflict'` event (a `ConflictResolver`) before falling back to the configured `conflictPolicy`.
 * `deleteLocal(uri)` records a per-device tombstone that hides the URI from `list()` without
 * touching the pod; URIs starting with `pseudo-pod://` are routed to the optional `pseudoPod`.
 */
export class PodClient extends Emitter {
  #podSource;
  #auth;
  #pseudoPod;
  #etagMap = new Map(); // uri → { etag, lastModified }
  #tombstoneStore;
  #closed = false;
  // Phase 52.16 (2026-05-14) — lazy ACP/WAC sharing namespace.
  #podRoot;
  #fetch;
  #sharing = null;
  /**
   * Per-event listener count, mirrored from `on`/`off`/`removeAllListeners`.
   * The base `Emitter` keeps its handler map private; we shadow the count so
   * `write` can take the no-listener fast-path on a conflict (skip the remote
   * fetch + skip the timeout wait).
   */
  #listenerCounts = new Map();

  /**
   * @param {object} opts
   * @param {string} opts.podRoot         — root URI of the pod
   * @param {object} opts.auth            — an Auth instance (CapabilityAuth/SolidOidcAuth)
   * @param {object} [opts.options]
   * @param {object} [opts.tombstoneStore] — `TombstoneStore` impl.  Defaults to
   *   a `MemoryTombstones` (non-persistent).  Production apps should pass a
   *   platform-appropriate adapter (`IndexedDBTombstones` /
   *   `AsyncStorageTombstones` / `FileTombstones`) so deletions survive
   *   process restarts.
   * @param {Function} [opts.podSourceFactory] — escape hatch for tests; receives
   *   `({ podUrl, fetch })` and returns a SolidPodSource-shaped object.
   * @param {object} [opts.pseudoPod]
   *   Optional `@onderling/pseudo-pod`-shaped object. When supplied, any URI
   *   passed to `read`/`write`/`list`/`delete` starting with `pseudo-pod://`
   *   is routed to this object instead of the real-pod backend. Standardisation
   *   Phase 52.6.3.
   */
  constructor({ podRoot, auth, options, tombstoneStore, podSourceFactory, pseudoPod } = {}) {
    super();
    if (!podRoot) throw mapSourceCode('INVALID_ARGUMENT', { message: 'PodClient: podRoot is required' });
    if (!auth)    throw mapSourceCode('INVALID_ARGUMENT', { message: 'PodClient: auth is required' });
    this.#auth          = auth;
    this.#podRoot       = podRoot;
    this.#tombstoneStore = tombstoneStore ?? new MemoryTombstones();
    this.#pseudoPod     = pseudoPod ?? null;
    const fetchFn  = this.#buildFetch();
    this.#fetch     = fetchFn;
    const factory  = podSourceFactory ?? ((init) => new SolidPodSource(init));
    this.#podSource = factory({ podUrl: podRoot, fetch: fetchFn });
    this.options    = {
      appendRetries:           DEFAULT_APPEND_RETRIES,
      conflictListenerTimeout: DEFAULT_CONFLICT_LISTENER_TIMEOUT_MS,
      ...(options || {}),
    };
  }

  /** Underlying SolidPodSource (or test-supplied stub).  Useful for advanced callers. */
  get source() { return this.#podSource; }

  /**
   * Lazy `client.sharing.*` namespace — Phase 52.16 (2026-05-14).
   * ACP/WAC-mediated sharing via `@inrupt/solid-client`'s Universal
   * Access API. First access builds the sharing instance bound to
   * this client's authenticated fetch.
   */
  get sharing() {
    if (!this.#sharing) {
      // Thread the authenticated owner's WebID (best-effort) so the direct
      // ACP `.acr` writer can include an owner-control policy. `identity()`
      // throws for auth adapters that don't expose a WebID (e.g. some
      // CapabilityAuth setups) — the writer degrades to an honest error there.
      let webid;
      try { webid = this.#auth?.identity?.(); } catch { /* no WebID available */ }
      this.#sharing = createClientSharing({
        fetch:   this.#fetch,
        podRoot: this.#podRoot,
        webid,
      });
    }
    return this.#sharing;
  }

  /** Internal etag/lastModified map — exposed for A7 conflict-detection layer. */
  get _etagMap() { return this.#etagMap; }

  /** The configured `TombstoneStore`.  Exposed for tests + advanced callers. */
  get tombstoneStore() { return this.#tombstoneStore; }

  // ── Emitter overrides ─────────────────────────────────────────────────────
  // Shadow the listener-count so the conflict path can take a no-listener
  // fast-path without breaking the base Emitter's encapsulation.

  on(event, fn) {
    this.#listenerCounts.set(event, (this.#listenerCounts.get(event) ?? 0) + 1);
    return super.on(event, fn);
  }
  off(event, fn) {
    const next = Math.max(0, (this.#listenerCounts.get(event) ?? 0) - 1);
    this.#listenerCounts.set(event, next);
    return super.off(event, fn);
  }
  once(event, fn) {
    // The base `once` calls `on` (which we already track), then `off` inside
    // a wrapper.  But the wrapper calls super's `off` directly, bypassing our
    // override.  Wrap manually to keep the count accurate.
    const wrapper = (...args) => { this.off(event, wrapper); fn(...args); };
    return this.on(event, wrapper);
  }
  removeAllListeners(event) {
    if (event) this.#listenerCounts.delete(event);
    else       this.#listenerCounts.clear();
    return super.removeAllListeners(event);
  }
  /** Public listener-count helper. */
  listenerCount(event) { return this.#listenerCounts.get(event) ?? 0; }

  // ── fetch wiring ──────────────────────────────────────────────────────────

  #buildFetch() {
    // SolidOidcAuth path: vault.getAuthenticatedFetch() returns a session-bound
    // fetch (DPoP-aware).  Use it directly — no header injection needed.
    if (typeof this.#auth.getAuthenticatedFetch === 'function') {
      try {
        const f = this.#auth.getAuthenticatedFetch();
        if (typeof f === 'function') return f;
      } catch {
        // fall through to header-injection path
      }
    }
    // CapabilityAuth path: wrap globalThis.fetch with a per-request header
    // injection from auth.getAuthHeaders(uri, method).
    return async (input, init = {}) => {
      const uri    = typeof input === 'string' ? input : input?.url;
      const method = (init.method || 'GET').toUpperCase();
      let headers  = {};
      try {
        headers = await this.#auth.getAuthHeaders(uri, method);
      } catch (err) {
        // Auth errors propagate naturally; SolidPodSource sees them as fetch
        // failures and throws NETWORK_ERROR — but we want them to surface as
        // AuthError.  Tag the failure for upstream mapping.
        const wrapped = new Error('PodClient: auth.getAuthHeaders failed');
        wrapped.code  = 'UNAUTHORIZED';
        wrapped.cause = err;
        throw wrapped;
      }
      const merged = { ...(init.headers || {}), ...headers };
      return globalThis.fetch(input, { ...init, headers: merged });
    };
  }

  // ── decode helpers ────────────────────────────────────────────────────────

  #decode(content, contentType, mode = 'auto') {
    if (mode === 'bytes')  return content;
    const isText = TEXT_CONTENT_TYPE_RE.test(contentType || '');
    if (mode === 'string') return new TextDecoder().decode(content);
    if (mode === 'json')   return JSON.parse(new TextDecoder().decode(content));
    // auto:
    if (!isText) return content;
    const text = new TextDecoder().decode(content);
    if (/^application\/.*json/i.test(contentType || '')) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }

  #wrapAndThrow(err, uri) {
    const code = err?.code || 'NETWORK_ERROR';
    throw mapSourceCode(code, { uri, cause: err, message: err?.message });
  }

  #ensureOpen() {
    if (this.#closed) throw mapSourceCode('INVALID_ARGUMENT', { message: 'PodClient: client is closed' });
  }

  /**
   * URI-scheme dispatch helper. Returns the pseudoPod object if the
   * URI is a `pseudo-pod://` ref AND a pseudoPod was injected; null
   * otherwise (caller falls through to the real-pod backend).
   *
   * Phase 52.6.3 — see substrates-v2-coding-plan §52.6.
   */
  #pseudoPodFor(uri) {
    if (!this.#pseudoPod) return null;
    if (typeof uri !== 'string') return null;
    if (!uri.startsWith('pseudo-pod://')) return null;
    return this.#pseudoPod;
  }

  /**
   * Translate a pseudo-pod read record into the PodClient.read shape.
   * pseudoPod returns `{uri, bytes, etag?}`; PodClient.read returns
   * `{content, contentType, lastModified, etag, size}`.
   */
  #pseudoPodReadShape(rec, opts) {
    if (!rec) return null;
    const bytes = rec.bytes;
    let contentType;
    let content = bytes;
    if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
      contentType = 'application/octet-stream';
      if (opts?.decode === 'string') content = new TextDecoder().decode(bytes);
      else if (opts?.decode === 'json') content = JSON.parse(new TextDecoder().decode(bytes));
    } else if (typeof bytes === 'string') {
      contentType = 'text/plain';
      if (opts?.decode === 'json') content = JSON.parse(bytes);
    } else if (bytes && typeof bytes === 'object') {
      contentType = 'application/json';
      // `auto` / `string` / `bytes`: leave as object. `json`: already an object.
    } else {
      contentType = 'application/octet-stream';
    }
    return {
      uri:          rec.uri,
      content,
      contentType,
      lastModified: null,
      etag:         rec.etag ?? null,
      size:         null,
    };
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Read a resource.
   *
   * @param {string} uri
   * @param {object} [opts]
   * @param {'auto'|'string'|'bytes'|'json'} [opts.decode='auto']
   * @returns {Promise<{ content, contentType, lastModified, etag, size }>}
   */
  async read(uri, opts = {}) {
    this.#ensureOpen();
    const pp = this.#pseudoPodFor(uri);
    if (pp) {
      const rec = await pp.read(uri);
      const shaped = this.#pseudoPodReadShape(rec, opts);
      if (!shaped) throw mapSourceCode('NOT_FOUND', { uri });
      return shaped;
    }
    let res;
    try {
      res = await this.#podSource.read(uri, opts);
    } catch (err) {
      // 404-GC: if the resource is gone from the pod, any local tombstone is
      // redundant (the resource was deleted by another device).  Best-effort:
      // swallow tombstone-store errors so we never mask the real read failure.
      if (err?.code === 'NOT_FOUND') {
        try { await this.#tombstoneStore.remove(uri); } catch { /* swallow */ }
      }
      this.#wrapAndThrow(err, uri);
    }
    if (res.etag || res.lastModified) {
      this.#etagMap.set(uri, { etag: res.etag, lastModified: res.lastModified });
    }
    const content = this.#decode(res.content, res.contentType, opts.decode || 'auto');
    return { ...res, content };
  }

  /**
   * List a container.  By default, URIs marked deleted-locally (via
   * `deleteLocal`) are filtered out.  Pass `opts.includeTombstoned: true`
   * to surface them (useful for "you previously deleted these locally —
   * restore?").
   *
   * @param {string} containerUri
   * @param {object} [opts]
   * @param {boolean} [opts.recursive=false]
   * @param {(uri: string) => boolean} [opts.filter]
   * @param {boolean} [opts.includeTombstoned=false]
   * @returns {Promise<{ container, entries }>}
   */
  async list(containerUri, opts = {}) {
    this.#ensureOpen();
    const pp = this.#pseudoPodFor(containerUri);
    if (pp) {
      const keys = await pp.list(containerUri);
      let entries = keys.map((uri) => ({ uri }));
      if (opts.filter) entries = entries.filter((e) => opts.filter(e.uri));
      return { container: containerUri, entries };
    }
    // Strip pod-client-specific opts before forwarding to the pod source.
    const sourceOpts = { ...opts };
    delete sourceOpts.includeTombstoned;
    delete sourceOpts.filter;
    try {
      const res = await this.#podSource.list(containerUri, sourceOpts);
      let entries = res.entries;
      if (opts.filter) entries = entries.filter((e) => opts.filter(e.uri));
      if (!opts.includeTombstoned) {
        const filtered = [];
        for (const e of entries) {
          // Best-effort: if the tombstone store fails, surface the entry.
          let isTombstoned = false;
          try { isTombstoned = await this.#tombstoneStore.has(e.uri); }
          catch { isTombstoned = false; }
          if (!isTombstoned) filtered.push(e);
        }
        entries = filtered;
      }
      return { ...res, entries };
    } catch (err) {
      this.#wrapAndThrow(err, containerUri);
    }
  }

  /**
   * Write a resource.  Auto-attaches `If-Match` from the in-memory etag map
   * unless `opts.force === true`.
   *
   * On a 412 (write-conflict) the client:
   *   1. Builds a `'conflict'` event carrying local + remote contents (the
   *      remote is fetched on demand for small text/JSON; left undefined
   *      for binary or oversized resources — listeners can re-read).
   *   2. Emits `'conflict'`.  A listener may call:
   *        - `event.resolveWith(content)` → re-write with `force: true`.
   *        - `event.cancelWrite()`        → throw `ConflictError`.
   *   3. If neither happens (no listener / listener does nothing within
   *      `options.conflictListenerTimeout`), the call falls through to
   *      `opts.conflictPolicy`:
   *        - `'reject'`        — throw `ConflictError` (DEFAULT, per Q-A.4).
   *        - `'lww'`           — silently retry with `force: true`.
   *        - `'remote-wins'`   — abandon; resolve with `{ skipped: true,
   *                              reason: 'remote-wins', ... }` and refresh
   *                              the etag from the pod's current version.
   *
   * @param {string} uri
   * @param {string|Uint8Array|ArrayBuffer|object} content
   * @param {object} [opts]
   * @param {string} [opts.contentType]
   * @param {string} [opts.ifMatch]
   * @param {boolean} [opts.force=false]
   * @param {'reject'|'lww'|'remote-wins'} [opts.conflictPolicy='reject']
   * @returns {Promise<{ uri, contentType, lastModified, etag, size, skipped?: boolean, reason?: string }>}
   */
  async write(uri, content, opts = {}) {
    this.#ensureOpen();
    const pp = this.#pseudoPodFor(uri);
    if (pp) {
      const { etag } = await pp.write(uri, content, opts.ifMatch);
      return {
        uri,
        contentType:  opts.contentType ?? null,
        lastModified: null,
        etag,
        size:         null,
      };
    }
    const policy = opts.conflictPolicy ?? DEFAULT_CONFLICT_POLICY;
    if (policy !== 'reject' && policy !== 'lww' && policy !== 'remote-wins') {
      throw mapSourceCode('INVALID_ARGUMENT', {
        message: `PodClient.write: invalid conflictPolicy '${policy}' (expected 'reject' | 'lww' | 'remote-wins')`,
        uri,
      });
    }

    try {
      return await this.#writeOnce(uri, content, opts);
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;

      // Internal callers (e.g. `append`'s retry loop) opt out of the 'conflict'
      // event because the etag race is a known false positive that the caller
      // is already handling.  Re-throw so the caller's loop sees it.
      if (opts._suppressConflictEvent) throw err;

      // Capture the local lastModified BEFORE we fetch the remote (which
      // overwrites the etag map as a side effect).
      const localLastModified = this.#etagMap.get(uri)?.lastModified ?? null;

      // Listener fast-path: if no one is subscribed, skip the event entirely.
      // For 'remote-wins' we still need a remote snapshot to fill the result.
      const hasListener = this.listenerCount('conflict') > 0;
      const needsRemote = hasListener || policy === 'remote-wins';
      const remoteSnapshot = needsRemote ? await this.#fetchRemoteForConflict(uri) : null;

      if (hasListener) {
        const resolver = new ConflictResolver({
          uri,
          localContent:        content,
          remoteContent:       remoteSnapshot?.content,
          localLastModified,
          remoteLastModified:  remoteSnapshot?.lastModified ?? null,
        });

        this.emit('conflict', resolver);

        const decision = await resolver._wait(this.options.conflictListenerTimeout);

        if (decision.kind === ConflictResolver.RESOLVE) {
          // Listener supplied merged content — force-overwrite.
          return this.#writeOnce(uri, decision.content, { ...opts, force: true });
        }
        if (decision.kind === ConflictResolver.CANCEL) {
          throw err;
        }
        // TIMEOUT → fall through to policy default.
      }
      // No listener (or listener did nothing) → policy fallthrough.
      if (policy === 'reject')      throw err;
      if (policy === 'lww')         return this.#writeOnce(uri, content, { ...opts, force: true });
      if (policy === 'remote-wins') return this.#abandonForRemote(uri, remoteSnapshot);
      throw err; // unreachable
    }
  }

  /**
   * Single-shot write.  Pulls etag from the map, JSON-encodes objects,
   * forwards to `#podSource.write`, and updates the etag map on success.
   * Throws the `mapSourceCode`-wrapped error on failure (so callers see
   * `ConflictError` for 412s).
   *
   * @internal
   */
  async #writeOnce(uri, content, opts = {}) {
    const writeOpts = { ...opts };
    delete writeOpts.conflictPolicy; // not for the source layer
    delete writeOpts._suppressConflictEvent;
    if (!opts.force && !opts.ifMatch) {
      const known = this.#etagMap.get(uri);
      if (known?.etag)              writeOpts.ifMatch         = known.etag;
      else if (known?.lastModified) writeOpts.ifUnmodifiedSince = known.lastModified;
    }
    delete writeOpts.force;

    const payload =
      content instanceof Uint8Array || content instanceof ArrayBuffer || typeof content === 'string'
        ? content
        : JSON.stringify(content);
    if (typeof content !== 'string' && !(content instanceof Uint8Array) && !(content instanceof ArrayBuffer) && !writeOpts.contentType) {
      writeOpts.contentType = 'application/json';
    }

    let res;
    try {
      res = await this.#podSource.write(uri, payload, writeOpts);
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
    if (res?.etag || res?.lastModified) {
      this.#etagMap.set(uri, { etag: res.etag, lastModified: res.lastModified });
    }
    return res;
  }

  /**
   * Best-effort fetch of the remote version on a 412, so we can attach it to
   * the `'conflict'` event.  Returns `null` if the read fails; otherwise the
   * raw read result with `content` decoded for small text/JSON, or
   * `undefined` for binary/oversized payloads.
   *
   * Side effect: refreshes the etag map from the just-read remote so a
   * subsequent `force: true` write or a `'remote-wins'` resolution has the
   * pod's current state.
   *
   * @internal
   */
  async #fetchRemoteForConflict(uri) {
    try {
      const res = await this.#podSource.read(uri);
      if (res?.etag || res?.lastModified) {
        this.#etagMap.set(uri, { etag: res.etag, lastModified: res.lastModified });
      }
      const isText = TEXT_CONTENT_TYPE_RE.test(res?.contentType || '');
      const tooBig = typeof res?.size === 'number' && res.size > REMOTE_CONTENT_FETCH_LIMIT;
      const content = (!tooBig && isText && res?.content !== undefined && res?.content !== null)
        ? this.#decode(res.content, res.contentType, 'auto')
        : undefined;
      return { ...res, content };
    } catch {
      return null;
    }
  }

  /**
   * Caller picked `conflictPolicy: 'remote-wins'`.  Refresh our etag from
   * the pod's current version (already done in `#fetchRemoteForConflict`)
   * and resolve the write promise with a `skipped: true` shape.
   *
   * @internal
   */
  #abandonForRemote(uri, remoteSnapshot) {
    return {
      uri,
      contentType:  remoteSnapshot?.contentType,
      lastModified: remoteSnapshot?.lastModified,
      etag:         remoteSnapshot?.etag,
      size:         remoteSnapshot?.size,
      skipped:      true,
      reason:       'remote-wins',
    };
  }

  /**
   * Append a line to a text resource.  Read-modify-write with retry on
   * `ConflictError` (max retries from `options.appendRetries`, default 3).
   * Throws `ConflictError` with code `CONFLICT_RETRY_EXHAUSTED` if retries
   * exhaust.
   *
   * @param {string} uri
   * @param {string} line  — a string; `\n` appended automatically if not present.
   * @param {object} [opts]
   * @returns {Promise<{ uri, contentType, lastModified, etag, size }>}
   */
  async append(uri, line, opts = {}) {
    this.#ensureOpen();
    const maxRetries = opts.retries ?? this.options.appendRetries;
    const tail = line.endsWith('\n') ? line : `${line}\n`;

    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let existing  = '';
      let contentType = opts.contentType || 'text/plain';
      try {
        const res = await this.read(uri, { decode: 'string' });
        existing    = res.content;
        contentType = res.contentType || contentType;
      } catch (err) {
        // 404 → start fresh; any other error is fatal.
        if (err?.code !== 'NOT_FOUND') throw err;
        this.#etagMap.delete(uri);
      }

      const next = existing + tail;
      try {
        // Append's etag race is a known false positive (the underlying log
        // is associative).  We use the strict 'reject' policy + suppress the
        // public 'conflict' event so this loop is the only thing that sees
        // the 412.
        return await this.write(uri, next, {
          contentType,
          conflictPolicy:        'reject',
          _suppressConflictEvent: true,
        });
      } catch (err) {
        if (err instanceof ConflictError) {
          lastErr = err;
          // drop the stale etag so the next attempt re-fetches
          this.#etagMap.delete(uri);
          continue;
        }
        throw err;
      }
    }

    throw new ConflictError(
      `PodClient.append: retries exhausted after ${maxRetries} conflict(s) on ${uri}`,
      { code: 'CONFLICT_RETRY_EXHAUSTED', uri, cause: lastErr },
    );
  }

  /**
   * Apply an n3-style RDF patch via Inrupt's dataset API (v1, path (a)).
   *
   * Accepts a small triple shape — each entry is
   * `{ subject, predicate, object, datatype? }`:
   *   - `subject`   — a Thing URL (string).  If omitted, defaults to a new
   *                   blank Thing rooted at `uri`.
   *   - `predicate` — a property URL (string).
   *   - `object`    — a URL string (default), or a literal when
   *                   `datatype === 'string'`.
   *
   * For richer RDF semantics, callers can pass a custom `applyFn` that
   * receives the `SolidDataset` and returns a mutated one.
   *
   * @param {string} uri
   * @param {{ add?: Triple[], remove?: Triple[], applyFn?: Function }} patch
   * @param {object} [opts]
   * @returns {Promise<{ uri }>}
   */
  async patch(uri, patch = {}, _opts = {}) {  // eslint-disable-line no-unused-vars
    this.#ensureOpen();
    const I = await loadInrupt();
    const fetchFn = this.#buildFetch();
    let dataset;
    try {
      dataset = await I.getSolidDataset(uri, { fetch: fetchFn });
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }

    if (typeof patch.applyFn === 'function') {
      dataset = patch.applyFn(dataset);
    } else {
      const adds    = Array.isArray(patch.add)    ? patch.add    : [];
      const removes = Array.isArray(patch.remove) ? patch.remove : [];

      for (const t of removes) {
        const subj = t.subject || uri;
        let thing  = I.getThing(dataset, subj) || I.createThing({ url: subj });
        if (t.object === undefined || t.object === null) {
          thing = I.removeAll(thing, t.predicate);
        } else if (t.datatype === 'string') {
          // No removeStringNoLocale on a Thing; fall back to removeAll for that predicate.
          thing = I.removeAll(thing, t.predicate);
        } else {
          thing = I.removeUrl(thing, t.predicate, t.object);
        }
        dataset = I.setThing(dataset, thing);
      }

      for (const t of adds) {
        const subj = t.subject || uri;
        let thing  = I.getThing(dataset, subj) || I.createThing({ url: subj });
        if (t.datatype === 'string') {
          thing = I.addStringNoLocale(thing, t.predicate, String(t.object));
        } else {
          thing = I.addUrl(thing, t.predicate, t.object);
        }
        dataset = I.setThing(dataset, thing);
      }
    }

    try {
      await I.saveSolidDatasetAt(uri, dataset, { fetch: fetchFn });
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
    return { uri };
  }

  /**
   * Idempotently create an LDP container at `uri`.  Required by some pod
   * servers (e.g. Inrupt's storage.inrupt.com) which don't auto-create
   * parent containers on PUT — without an explicit container, the first
   * `write()` to a fresh sub-path 404s.  Trailing slash is enforced.
   *
   * No-op if the container already exists.
   *
   * @param {string} uri
   * @returns {Promise<{ uri: string }>}
   */
  async createContainer(uri) {
    this.#ensureOpen();
    if (typeof this.#podSource.createContainer !== 'function') {
      // Mock/test sources may not implement this; treat as success (the
      // mock pod is hierarchical-by-string-key — no containers to track).
      const resolved = uri.endsWith('/') ? uri : `${uri}/`;
      return { uri: resolved };
    }
    try {
      return await this.#podSource.createContainer(uri);
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
  }

  /**
   * Delete a resource from the pod.  Removes the resource for everyone (it
   * is gone from the pod once the call succeeds).  Also clears any local
   * tombstone — the local marker is no longer relevant once the resource
   * is gone everywhere.
   *
   * Equivalent to `deleteCompletely(uri, opts)`; both names exist for
   * spec-compliance with `pod-client-api.md` §Delete scope.
   *
   * @param {string} uri
   * @param {object} [opts]
   * @param {string}  [opts.ifMatch]
   * @param {boolean} [opts.force=false]
   */
  async delete(uri, opts = {}) {
    this.#ensureOpen();
    const pp = this.#pseudoPodFor(uri);
    if (pp) {
      await pp.delete(uri);
      this.#etagMap.delete(uri);
      return { uri };
    }
    const delOpts = { ...opts };
    if (!opts.force && !opts.ifMatch) {
      const known = this.#etagMap.get(uri);
      if (known?.etag) delOpts.ifMatch = known.etag;
    }
    delete delOpts.force;
    try {
      await this.#podSource.delete(uri, delOpts);
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
    this.#etagMap.delete(uri);
    // Resource is gone from the pod — any local tombstone is now redundant.
    // Best-effort: swallow tombstone-store errors so we don't mask success.
    try { await this.#tombstoneStore.remove(uri); } catch { /* swallow */ }
  }

  /**
   * Spec alias for `delete(uri, opts)`.  See `pod-client-api.md` §Delete
   * scope — `deleteCompletely` is the explicit-scope name; `delete` is the
   * shorter convenience.  Identical behaviour: remove from pod + clear any
   * local tombstone.
   *
   * @param {string} uri
   * @param {object} [opts]
   */
  async deleteCompletely(uri, opts = {}) {
    return this.delete(uri, opts);
  }

  /**
   * Mark a resource deleted on this device only.  The pod is NOT touched.
   *
   * Records a tombstone so future `client.list()` calls hide this URI
   * (unless `includeTombstoned: true` is passed) and any app-level sync
   * routine the app builds can skip it.
   *
   * The tombstone is automatically cleared if a later `read(uri)` returns
   * 404 (resource gone from pod — local marker redundant) or if
   * `deleteCompletely(uri)` succeeds (resource gone everywhere).  Use
   * `clearTombstone(uri)` to undo.
   *
   * Note: `deleteLocal` is the per-device exception path within whatever
   * the app has chosen to sync.  The SDK does not auto-sync.
   *
   * @param {string} uri
   * @returns {Promise<void>}
   */
  async deleteLocal(uri) {
    this.#ensureOpen();
    await this.#tombstoneStore.add(uri, { at: Date.now() });
    // Drop any cached etag — we no longer claim to know the resource state
    // from this device's POV.
    this.#etagMap.delete(uri);
  }

  /**
   * Clear a previously-set local tombstone for `uri`.  "I changed my mind."
   *
   * Idempotent: removing an absent tombstone is a no-op.
   *
   * @param {string} uri
   * @returns {Promise<void>}
   */
  async clearTombstone(uri) {
    this.#ensureOpen();
    await this.#tombstoneStore.remove(uri);
  }

  /** Idempotent close.  Clears the etag map and propagates to auth + tombstone store. */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#etagMap.clear();
    if (typeof this.#auth.close === 'function') {
      try { await this.#auth.close(); } catch { /* swallow — close is best-effort */ }
    }
    if (this.#tombstoneStore && typeof this.#tombstoneStore.close === 'function') {
      try { await this.#tombstoneStore.close(); } catch { /* swallow */ }
    }
  }

  /** Alias for close(), per pod-client-api.md §Lifecycle. */
  async disconnect() { await this.close(); }
}
