/**
 * PseudoPod — the Solid-shaped local store at the heart of the
 * substrate-layer V2 work.
 *
 * V0 (Phase 52.2) ships two modes:
 *   - `standalone`        — single-device, no fan-out. Local store
 *                           is the canonical source of truth.
 *   - `replication-ring`  — every write is eagerly fanned out to
 *                           peers via `transport.publishEnvelope`.
 *                           Local store is still canonical; peers
 *                           reconcile via `writeFromPeer`.
 *
 * V1 (Phase 52.8) adds:
 *   - `cache`             — local-immediate writes are queued for
 *                           write-through to a real pod via the
 *                           injected `podUploader`. Reads fall through
 *                           to `podFetcher` on local miss + cache the
 *                           result. Graceful degradation: when
 *                           `isPodReachable(uri)` returns false, the
 *                           write stays queued until `drainWriteThroughQueue()`
 *                           is invoked.
 *   - **Per-URI mode override** (`setMode(uri, mode)`): a single
 *                           PseudoPod can run different modes for
 *                           different resources (e.g. notes in cache;
 *                           circle items in replication-ring).
 *
 * URI scheme:
 *   `pseudo-pod://<deviceId>/<path>` — local namespace.
 *   `https://...` URIs — cache-mode only.
 *
 * Standardisation Phase 52.2 + 52.8 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
 * and the functional design §4.1.
 *
 * ── Portability (Node vs web/RN) ──────────────────────────────────────
 * This module has ZERO `node:` imports and is runtime-agnostic in EVERY
 * mode. What decides portability is purely what the caller injects:
 *   - `standalone` / `replication-ring`: need only a `backend`. With a
 *     portable backend (`MemoryBackend` = pure JS, or a browser
 *     IndexedDB backend) these modes are fully web-proof — no Node.
 *   - `cache`: additionally needs `podUploader`/`podFetcher`, and for
 *     its offline-durability guarantee the `backend` MUST persist
 *     across process restarts. Node enters ONLY through the persistent
 *     backend you pick on desktop (a Node FS backend); cache mode is
 *     itself not Node-bound — a browser IndexedDB backend / an RN
 *     AsyncStorage backend keep it web/mobile-proof.
 * Invariant: never add a `node:` import to this file. Runtime-specific
 * code belongs in the injected backend / pod functions, not here.
 *
 * @typedef {import('./StorageBackend.js').StorageBackend} StorageBackend
 * @typedef {'standalone'|'replication-ring'|'cache'} PseudoPodMode
 */

import { makeFetchResourceSkill }    from '@onderling/core';
import { createWriteThroughQueue }   from './writeThroughQueue.js';

/** Envelope kind used for replication-ring fan-out in V0.
 *  Phase 52.4 (`notify-envelope`) will own this string. */
const REPLICATION_KIND = 'pseudo-pod.write';

/**
 * The store-backing modes a PseudoPod runs in — the store-adapter half of a
 * circle's data-policy. Exported so a single upstream mapping (basis's
 * `circleDataPolicy`) can derive the mode from a circle's `pod` posture
 * without re-hardcoding the vocabulary here and drifting apart.
 *   - `standalone`       — local only, no fan-out, no pod (a no-pod circle).
 *   - `replication-ring` — writes fan out to peers; local stays canonical.
 *   - `cache`            — write-through to a real pod (a pod-backed circle).
 * @type {ReadonlyArray<'standalone'|'replication-ring'|'cache'>}
 */
export const PSEUDO_POD_MODES = Object.freeze(['standalone', 'replication-ring', 'cache']);

const VALID_MODES = new Set(PSEUDO_POD_MODES);

/**
 * @param {object} opts
 * @param {StorageBackend} opts.backend           — required.
 * @param {'standalone'|'replication-ring'|'cache'} opts.mode  — global default mode.
 * @param {string}         opts.deviceId          — short id used in URIs (e.g. 'laptop-xyz').
 * @param {object}         [opts.transport]       — required iff mode is 'replication-ring'.
 * @param {() => string[]} [opts.getPeers]        — required iff mode is 'replication-ring'.
 * @param {string}         [opts.fromActor]       — agent-uri tagged on outbound envelopes.
 *
 * V1 (cache mode) opts:
 * Portability note: cache mode's offline-durability guarantee only holds
 * if `backend` persists across restarts (Node FS backend on desktop,
 * IndexedDB in a browser, AsyncStorage/SQLite on RN). `MemoryBackend`
 * works functionally but loses the write-through queue on restart — fine
 * for tests, not for a real cache-mode deployment.
 * @param {(uri: string) => Promise<{bytes: *, etag?: string} | null>} [opts.podFetcher]
 *   — required for cache reads when local has a miss. Wires to pod-client.read.
 * @param {(uri: string, bytes: *, etag?: string) => Promise<{etag?: string} | void>} [opts.podUploader]
 *   — required for cache writes' write-through to the real pod. Wires to pod-client.write.
 * @param {(uri: string) => boolean} [opts.isPodReachable]
 *   — graceful-degradation gate. When supplied, cache-mode writes that find
 *   the pod unreachable stay in the write-through queue until
 *   `drainWriteThroughQueue()` is called on reconnect.
 *
 * Versioning seam (PLAN-pod-versioning-history-recovery):
 * @param {{capture: (uri: string, content: *) => Promise<*>}} [opts.versioning]
 *   — optional version store (duck-typed; `@onderling/versioning`'s
 *   `createVersionStore`). When supplied, the write path snapshots the
 *   DISPLACED bytes before they are lost: prior local bytes on `write`,
 *   `writeFromPeer` peer-update, and `delete`; the DROPPED PEER FORK on a
 *   `concurrent-write` (today's LWW winner-select silently discards the
 *   loser — with versioning it lands in history, recoverable). Stale-peer /
 *   idempotent re-deliveries are NOT captured (noise). Capture is
 *   best-effort: a throwing store never breaks the write path. The seam
 *   lives INSIDE the pseudo-pod (not a wrapper) so peer writes can't bypass
 *   it via a stale inner reference — NotifyEnvelope et al. hold this object.
 */
/**
 * Create a PseudoPod — the Solid-shaped local store. `mode` sets the global behaviour: `standalone`
 * (local only), `replication-ring` (writes fan out to peers via `transport.publishEnvelope`;
 * requires `transport` + `getPeers`), or `cache` (local-immediate writes queued for write-through
 * via `podUploader`, reads falling through to `podFetcher` on a local miss; both required).
 * `setMode(uri, mode)` overrides the mode per URI. An optional `versioning` store snapshots
 * displaced bytes on the write path (best-effort). Throws `INVALID_ARGUMENT` when a required
 * option for the chosen mode is missing or invalid. Per-option detail: the `@param` block above.
 *
 * @param {object} opts — `{ backend, mode, deviceId }` plus the per-mode deps documented above.
 * @returns {object} the pseudo-pod instance: `read` / `write` / `delete` / `list` / `subscribe` /
 *   `writeFromPeer` / `flush` / `mode` / `setMode` / `fetchResourceSkill` / `on` / `off` /
 *   `drainWriteThroughQueue` / `listWriteThroughPending` / `writeThroughPendingCount`, plus
 *   introspection getters (`deviceId`, `backend`, `currentMode`, …).
 */
export function createPseudoPod({
  backend,
  mode,
  deviceId,
  transport,
  getPeers,
  fromActor,
  podFetcher,
  podUploader,
  isPodReachable,
  versioning,
} = {}) {
  if (!backend || typeof backend.get !== 'function') {
    throw Object.assign(
      new Error('createPseudoPod: `backend` (StorageBackend) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!VALID_MODES.has(mode)) {
    throw Object.assign(
      new Error('createPseudoPod: `mode` must be "standalone", "replication-ring", or "cache"'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('createPseudoPod: `deviceId` must be a non-empty string'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (mode === 'replication-ring') {
    if (!transport || typeof transport.publishEnvelope !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: replication-ring mode requires `transport.publishEnvelope`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof getPeers !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: replication-ring mode requires `getPeers: () => string[]`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }
  if (mode === 'cache') {
    if (typeof podUploader !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: cache mode requires `podUploader`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof podFetcher !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: cache mode requires `podFetcher`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }
  if (versioning != null && typeof versioning.capture !== 'function') {
    throw Object.assign(
      new Error('createPseudoPod: `versioning` must expose capture(uri, content)'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  /** 4b HARD INVARIANT (PLAN-pod-versioning-history-recovery): when a
   *  version store is attached, the history layer under its key prefix is
   *  IMMUTABLE through this pod — `write`/`delete` refuse it in EVERY mode
   *  (incl. cache, which skips `_assertLocalWrite`), and `writeFromPeer`
   *  rejects it (a hostile peer must not rewrite history). Only the store
   *  itself appends new records; its privileged `prune`/`drop` live on the
   *  store object, which is never skill-reachable. */
  const historyRoot = versioning
    ? (typeof versioning.versionsRoot === 'string' && versioning.versionsRoot.length > 0
        ? versioning.versionsRoot
        : 'versions/')
    : null;
  const _isHistoryKey = (uri) => historyRoot != null && String(uri).startsWith(historyRoot);
  function _assertNotHistory(uri, op) {
    if (_isHistoryKey(uri)) {
      throw Object.assign(
        new Error(`pseudo-pod.${op}: "${uri}" is under the version-history layer ("${historyRoot}") — history is immutable through the pod (agents append via displacement capture only)`),
        { code: 'HISTORY_IMMUTABLE' },
      );
    }
  }

  /**
   * Snapshot displaced/dropped bytes into the version store — best-effort:
   * versioning must never break the write path. `content` is whatever the
   * displaced record held (`bytes` is opaque to the pseudo-pod).
   */
  async function _captureDisplaced(uri, content) {
    if (!versioning || content === undefined) return;
    try { await versioning.capture(uri, content); }
    catch (_err) { /* swallow — capture is best-effort, the write proceeds */ }
  }

  /** @type {Map<string, 'standalone'|'replication-ring'|'cache'>} */
  const perUriMode = new Map();

  function _modeFor(uri) {
    return perUriMode.get(uri) ?? mode;
  }

  /** Phase 52.14 (Q-D 2026-05-14) — event subscribers for the
   *  conflict-resolution surface. Events:
   *    - 'peer-update'      → inbound _v > local _v, we adopted.
   *    - 'stale-peer'       → inbound _v < local _v, we ignored.
   *    - 'concurrent-write' → same _v, different bytes/etag.
   *  Apps subscribe via `pseudoPod.on(event, cb)`. Errors thrown by
   *  subscribers are swallowed so a faulty listener can't break the
   *  receive path.
   *  @type {Map<string, Set<(payload: object) => void>>} */
  const eventSubscribers = new Map();

  function _emitEvent(event, payload) {
    const subs = eventSubscribers.get(event);
    if (!subs) return;
    for (const cb of subs) {
      try { cb(payload); } catch (_err) { /* swallow — substrate-internal */ }
    }
  }

  function on(event, cb) {
    if (typeof event !== 'string' || event.length === 0) {
      throw Object.assign(
        new Error('pseudo-pod.on: event must be a non-empty string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('pseudo-pod.on: cb must be a function'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    let subs = eventSubscribers.get(event);
    if (!subs) { subs = new Set(); eventSubscribers.set(event, subs); }
    subs.add(cb);
    return () => off(event, cb);
  }

  function off(event, cb) {
    const subs = eventSubscribers.get(event);
    if (!subs) return;
    subs.delete(cb);
    if (subs.size === 0) eventSubscribers.delete(event);
  }

  const writeThroughQueue = createWriteThroughQueue({ backend });

  const uriPrefix = `pseudo-pod://${deviceId}/`;

  /**
   * Translate a URI to the backend key (the URI itself — keeps
   * semantics simple). Validates that the input is a non-empty
   * string. Scheme enforcement is split per operation:
   *
   *   - read / list / writeFromPeer  → accept any scheme (the
   *     pseudo-pod is a local cache for peer-replicated resources
   *     regardless of their canonical URI scheme).
   *   - write / delete               → the caller is the owner;
   *     enforced separately to be a local `pseudo-pod://<deviceId>/`
   *     URI via `_assertLocalWrite`.
   */
  function _keyForUri(uri) {
    if (typeof uri !== 'string') {
      throw Object.assign(
        new Error('pseudo-pod: uri must be a string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (uri.length === 0) {
      throw Object.assign(
        new Error('pseudo-pod: uri must be non-empty'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return uri;
  }

  /**
   * Enforce that an outbound write/delete targets THIS device's
   * pseudo-pod namespace. Used by `write` and `delete`.
   */
  function _assertLocalWrite(uri) {
    if (!uri.startsWith('pseudo-pod://')) {
      throw Object.assign(
        new Error(`pseudo-pod: cannot write to non-pseudo-pod URI "${uri}" — V0 only writes to pseudo-pod://`),
        { code: 'UNSUPPORTED_SCHEME' },
      );
    }
    if (!_isLocalUri(uri)) {
      throw Object.assign(
        new Error(`pseudo-pod: cannot write to non-local URI "${uri}" (deviceId mismatch)`),
        { code: 'NOT_LOCAL' },
      );
    }
  }

  /** Is this URI local to *this* device? */
  function _isLocalUri(uri) {
    return uri.startsWith(uriPrefix);
  }

  /**
   * Read a resource. Cache-mode V1 (Phase 52.8) falls through to the
   * pod on local miss.
   *
   * Phase 52.14 (Q-D 2026-05-14) adds an optional `freshness` opt for
   * cache mode:
   *   - `'cached'` (default) — return the local copy if present (fast).
   *   - `'fresh'`            — force a pod refresh. The local etag is
   *                            sent as `If-None-Match`; the pod
   *                            returns `null` / a `notModified` flag
   *                            if unchanged, or the new payload
   *                            otherwise. Wired via `podFetcher`'s
   *                            optional second arg `{ ifNoneMatch }`.
   *
   * For non-cache modes the opt is a no-op.
   *
   * @param {string} uri
   * @param {object} [opts]
   * @param {'cached'|'fresh'} [opts.freshness='cached']
   */
  async function read(uri, opts = {}) {
    const key = _keyForUri(uri);
    const freshness = opts && typeof opts.freshness === 'string'
      ? opts.freshness
      : 'cached';
    const effectiveMode = _modeFor(uri);
    const rec = await backend.get(key);

    // Force-fresh: hit the pod with If-None-Match to check.
    if (freshness === 'fresh' && effectiveMode === 'cache' && typeof podFetcher === 'function') {
      try {
        const remote = await podFetcher(uri, {
          ...(rec && rec.etag != null ? { ifNoneMatch: rec.etag } : {}),
        });
        // Conditional-GET: pod says "still current" → return cached copy.
        if (remote && (remote.notModified === true || remote.bytes === undefined)) {
          if (rec) {
            return {
              uri,
              bytes: rec.bytes,
              ...(rec.etag != null ? { etag: rec.etag } : {}),
              ...(typeof rec._v === 'number' ? { _v: rec._v } : {}),
            };
          }
          return null;
        }
        if (remote && remote.bytes !== undefined) {
          // Pin _v if we had a local copy — a pod refresh is a content
          // update from THIS device's perspective, so bump by one.
          await backend.put(key, remote.bytes, remote.etag);
          const fresh = await backend.get(key);
          return {
            uri,
            bytes: fresh.bytes,
            ...(fresh.etag != null ? { etag: fresh.etag } : {}),
            ...(typeof fresh._v === 'number' ? { _v: fresh._v } : {}),
          };
        }
      } catch (_err) {
        // Network error → fall back to whatever is cached.
      }
    }

    if (rec) {
      return {
        uri,
        bytes: rec.bytes,
        ...(rec.etag != null ? { etag: rec.etag } : {}),
        ...(typeof rec._v === 'number' ? { _v: rec._v } : {}),
      };
    }

    // Cache mode: fall through to the pod on local miss.
    if (effectiveMode === 'cache' && typeof podFetcher === 'function') {
      try {
        const remote = await podFetcher(uri);
        if (remote && remote.bytes !== undefined) {
          await backend.put(key, remote.bytes, remote.etag);
          return { uri, bytes: remote.bytes, ...(remote.etag != null ? { etag: remote.etag } : {}) };
        }
      } catch (_err) {
        // Network errors → treat as a miss. Caller can retry later.
      }
    }
    return null;
  }

  async function write(uri, bytes, etag) {
    const key = _keyForUri(uri);
    const effectiveMode = _modeFor(uri);

    // 4b: the history layer is immutable through the pod — every mode
    // (cache mode skips _assertLocalWrite, so this must come first).
    _assertNotHistory(uri, 'write');
    // Standalone + replication-ring writes must be device-local.
    // Cache writes accept https:// (the pod's own URI scheme).
    if (effectiveMode !== 'cache') _assertLocalWrite(uri);

    // Versioning: snapshot the DISPLACED prior bytes before overwriting.
    if (versioning) {
      const prior = await backend.get(key);
      if (prior) await _captureDisplaced(uri, prior.bytes);
    }

    const { etag: newEtag, _v: newV } = await backend.put(key, bytes, etag);

    if (effectiveMode === 'replication-ring') {
      const recipients = getPeers().filter(p => typeof p === 'string' && p.length > 0);
      if (recipients.length > 0) {
        try {
          await transport.publishEnvelope({
            kind: REPLICATION_KIND,
            ref:  uri,
            etag: newEtag,
            // Phase 52.14 (Q-D 2026-05-14) — include the Lamport
            // counter both at the envelope top level (for the standard
            // notify-envelope receive path) and inside the payload
            // (for direct readers). Forward-additive: legacy peers
            // ignore the field.
            _v:   newV,
            ...(fromActor != null ? { fromActor } : {}),
            recipients,
            payload: { uri, bytes, etag: newEtag, _v: newV },
          });
        } catch (_err) {
          // Replication is best-effort in V0. V1 will queue retries
          // via the backend's dirty-set.
        }
      }
    }

    // Cache mode: write-through to the real pod; on failure / pod
    // unreachable the write parks in the write-through queue. That queue
    // lives in `backend`, so its restart-durability == the backend's
    // (persistent backend survives a restart; MemoryBackend does not).
    // This branch stays Node-free — the only runtime coupling is the
    // injected backend + podUploader, never this file.
    if (effectiveMode === 'cache') {
      const reachable = typeof isPodReachable === 'function' ? !!isPodReachable(uri) : true;
      if (reachable) {
        try {
          const result = await podUploader(uri, bytes, newEtag);
          if (result && result.etag) {
            // Pod assigned its own etag — replace our local etag with theirs.
            // Pin _v so we don't double-increment from the etag swap.
            await backend.put(key, bytes, result.etag, newV);
            return { uri, etag: result.etag, _v: newV };
          }
          return { uri, etag: newEtag, _v: newV };
        } catch (_err) {
          // Upload failed → queue for retry. Caller drains on reconnect.
          await writeThroughQueue.enqueue({ uri, bytes, etag: newEtag });
          return { uri, etag: newEtag, _v: newV, queued: true };
        }
      } else {
        // Pod unreachable up-front → queue immediately (graceful degradation).
        await writeThroughQueue.enqueue({ uri, bytes, etag: newEtag });
        return { uri, etag: newEtag, _v: newV, queued: true };
      }
    }

    return { uri, etag: newEtag, _v: newV };
  }

  async function deleteResource(uri) {
    const key = _keyForUri(uri);
    // 4b: history records can never be deleted through the pod (only the
    // store's privileged prune/drop, which are not skill-reachable).
    _assertNotHistory(uri, 'delete');
    if (_modeFor(uri) !== 'cache') _assertLocalWrite(uri);
    // Versioning: a delete is the most destructive op on this path (hard,
    // no tombstone) — snapshot the prior bytes so it becomes recoverable.
    if (versioning) {
      const prior = await backend.get(key);
      if (prior) await _captureDisplaced(uri, prior.bytes);
    }
    await backend.delete(key);
  }

  async function list(containerUri) {
    if (typeof containerUri !== 'string' || containerUri.length === 0) {
      throw Object.assign(
        new Error('pseudo-pod.list: containerUri must be a non-empty string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const prefix = containerUri.endsWith('/') ? containerUri : containerUri + '/';
    return backend.list(prefix);
  }

  function subscribe(uri, cb) {
    if (typeof uri !== 'string') {
      throw Object.assign(
        new Error('pseudo-pod.subscribe: uri must be a string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('pseudo-pod.subscribe: cb must be a function'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return backend.subscribe(uri, cb);
  }

  /**
   * Inbound write from a peer (replication-ring receive path). The
   * `notify-envelope` substrate (Phase 52.4) calls this when an
   * envelope with `kind === 'pseudo-pod.write'` arrives.
   *
   * V0 trust model: identity is already verified at the transport /
   * security-layer level. No additional ACL check here.
   *
   * Phase 52.14 (Q-D 2026-05-14) — three-way version compare:
   *   - inbound `_v` > local `_v`  → adopt, fire `'peer-update'`.
   *   - inbound `_v` < local `_v`  → ignore, fire `'stale-peer'`
   *     (carries local snapshot so caller can reply with the newer
   *     copy via `notify-envelope.publish`).
   *   - inbound `_v` == local `_v` + same etag → idempotent ignore.
   *   - inbound `_v` == local `_v` + different etag → fire
   *     `'concurrent-write'`; caller decides (default: keep local).
   *
   * Backwards-compat: when `_v` is undefined (legacy peer pre-Phase
   * 52.14), we fall back to last-write-wins so old senders still work.
   *
   * @param {string} uri
   * @param {*}      bytes
   * @param {string} [etag]
   * @param {number} [_v]    Lamport counter from the sender.
   * @param {object} [opts]
   * @param {string} [opts.fromActor]  Sender identity (for events).
   * @returns {Promise<{status: 'peer-update'|'stale-peer'|'concurrent-write'|'idempotent'|'written-no-version'|'rejected-history-immutable'}>}
   *   `rejected-history-immutable` (4b): the uri targets the attached
   *   version store's history layer — peers can never rewrite history.
   */
  async function writeFromPeer(uri, bytes, etag, _v, opts = {}) {
    const key = _keyForUri(uri);
    const fromActor = opts && typeof opts.fromActor === 'string' ? opts.fromActor : undefined;

    // 4b: a peer (hostile or buggy) must never rewrite the history layer.
    // Receive path → reject with a status, never throw (a bad envelope must
    // not break the dispatcher). History replication, if ever wanted, is an
    // explicit separate design — not an implicit peer write.
    if (_isHistoryKey(uri)) {
      return { status: 'rejected-history-immutable' };
    }

    // Legacy peer — no version, fall back to LWW. Lets old senders
    // remain interoperable while we roll out the new wire shape.
    if (typeof _v !== 'number') {
      if (versioning) {
        const prior = await backend.get(key);
        if (prior) await _captureDisplaced(uri, prior.bytes); // LWW displaces local unconditionally
      }
      await backend.put(key, bytes, etag);
      return { status: 'written-no-version' };
    }

    const local = await backend.get(key);

    // First-time write or local has no version → adopt peer's write.
    if (!local || typeof local._v !== 'number') {
      await backend.put(key, bytes, etag, _v);
      _emitEvent('peer-update', {
        uri,
        ...(fromActor != null ? { fromActor } : {}),
        peerV: _v,
        localV: local && typeof local._v === 'number' ? local._v : null,
      });
      return { status: 'peer-update' };
    }

    if (_v > local._v) {
      // Versioning: the peer's newer write DISPLACES our local bytes —
      // snapshot them first (nothing else retains them).
      await _captureDisplaced(uri, local.bytes);
      await backend.put(key, bytes, etag, _v);
      _emitEvent('peer-update', {
        uri,
        ...(fromActor != null ? { fromActor } : {}),
        peerV: _v,
        localV: local._v,
      });
      return { status: 'peer-update' };
    }

    if (_v < local._v) {
      _emitEvent('stale-peer', {
        uri,
        ...(fromActor != null ? { fromActor } : {}),
        peerV: _v,
        localV: local._v,
        localBytes: local.bytes,
        localEtag: local.etag ?? null,
      });
      return { status: 'stale-peer' };
    }

    // Same _v — idempotent replay if etag matches, otherwise a real
    // concurrent write (two devices wrote at the same logical version).
    if (etag != null && local.etag != null && etag === local.etag) {
      return { status: 'idempotent' };
    }

    // Versioning: LWW keeps local — the PEER'S FORK would be silently
    // dropped. Snapshot it so the losing concurrent edit stays recoverable
    // (softens the no-CRDT gap: the loser lands in history, not /dev/null).
    await _captureDisplaced(uri, bytes);
    _emitEvent('concurrent-write', {
      uri,
      ...(fromActor != null ? { fromActor } : {}),
      peerV: _v,
      localV: local._v,
      peerBytes: bytes,
      peerEtag: etag ?? null,
      localBytes: local.bytes,
      localEtag: local.etag ?? null,
    });
    return { status: 'concurrent-write' };
  }

  /**
   * Force a write-through to the pod for a single URI (cache mode).
   * For non-cache modes this is a no-op. Useful for "flush now"
   * paths (e.g. before close, or when the user explicitly hits "sync").
   */
  async function flush(uri) {
    if (typeof uri !== 'string' || _modeFor(uri) !== 'cache') return;
    if (typeof podUploader !== 'function') return;
    const rec = await backend.get(uri);
    if (!rec) return;
    try {
      const result = await podUploader(uri, rec.bytes, rec.etag);
      if (result && result.etag) {
        // Pin _v so the etag swap doesn't bump the version.
        await backend.put(uri, rec.bytes, result.etag, rec._v);
      }
    } catch (_err) {
      // Leave the entry in the queue (or enqueue it) for later drain.
      await writeThroughQueue.enqueue({ uri, bytes: rec.bytes, etag: rec.etag });
    }
  }

  /**
   * Resolve the effective mode for a URI — per-URI override wins,
   * else the global default.
   */
  function modeForUri(uri) {
    return _modeFor(uri);
  }

  /**
   * Pin a URI's effective mode. Passing `null` clears the override
   * (the global default takes over).
   *
   * @param {string} uri
   * @param {'standalone'|'replication-ring'|'cache'|null} m
   */
  function setMode(uri, m) {
    if (typeof uri !== 'string' || uri.length === 0) {
      throw Object.assign(
        new Error('setMode: uri is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (m === null) { perUriMode.delete(uri); return; }
    if (!VALID_MODES.has(m)) {
      throw Object.assign(
        new Error(`setMode: invalid mode "${m}"`),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    perUriMode.set(uri, m);
  }

  /**
   * Drain pending write-through entries (cache-mode V1). Called by
   * the caller when they observe a "pod reachable again" event. The
   * substrate doesn't auto-poll — higher-level code wires
   * reachability detection.
   *
   * @param {object} [opts]
   * @param {(entry: {uri: string, etag?: string, result: {etag?: string} | void}) => Promise<void>} [opts.onSuccess]
   *   — fires per drained entry. Useful for cross-substrate signalling
   *   (e.g. notify-envelope's "ring → pod-canonical" envelope re-emit).
   *
   * @returns {Promise<{drained: number, remaining: number, error?: Error}>}
   */
  async function drainWriteThroughQueue({ onSuccess } = {}) {
    if (typeof podUploader !== 'function') return { drained: 0, remaining: await writeThroughQueue.size() };
    return writeThroughQueue.drain({
      uploadFn: async (entry) => {
        const result = await podUploader(entry.uri, entry.bytes, entry.etag);
        // Pod-assigned etag wins; update the local copy. Pin _v so the
        // etag swap doesn't bump the version unnecessarily.
        if (result && result.etag) {
          const current = await backend.get(entry.uri);
          const pinnedV = current && typeof current._v === 'number' ? current._v : undefined;
          await backend.put(entry.uri, entry.bytes, result.etag, pinnedV);
        }
        return result;
      },
      onSuccess: typeof onSuccess === 'function'
        ? async (entry, result) => onSuccess({ uri: entry.uri, etag: entry.etag, result })
        : undefined,
    });
  }

  async function listWriteThroughPending() {
    return writeThroughQueue.list();
  }

  async function writeThroughPendingCount() {
    return writeThroughQueue.size();
  }

  /**
   * Build the `fetch-resource` skill bound to this pseudo-pod's
   * `read`. Apps register it on their agent so peers can fetch
   * resources from this device:
   *
   *   agent.skills.register(pseudoPod.fetchResourceSkill());
   *
   * The skill itself lives in core (`makeFetchResourceSkill`);
   * pseudo-pod just supplies the storage-backed reader.
   */
  /**
   * Build the `fetch-resource` skill bound to this pseudo-pod's
   * `read`. Apps register it on their agent so peers can fetch
   * resources from this device:
   *
   *   agent.skills.register(pseudoPod.fetchResourceSkill({groupCheck, capCheck}));
   *
   * **Phase 52.2.x (Q#2 2026-05-14) — peer-fetch gates.** Pass
   * through `groupCheck` + `capCheck` from `@onderling/core`'s
   * `makeFetchResourceSkill`. When neither is supplied, the skill
   * trust-the-transport's identity gate (back-compat).
   *
   * @param {object} [opts]
   * @param {(uri: string, ctx: object) => boolean|Promise<boolean>} [opts.groupCheck]
   * @param {(uri: string, ctx: object) => boolean|Promise<boolean>} [opts.capCheck]
   * @param {string}   [opts.id]
   * @param {'public'|'authenticated'|'trusted'|'private'} [opts.visibility]
   * @param {string}   [opts.description]
   */
  function fetchResourceSkill(opts = {}) {
    return makeFetchResourceSkill({
      read: async (uri) => {
        const rec = await read(uri);
        if (!rec) return null;
        return {
          bytes: rec.bytes,
          ...(rec.etag != null ? { etag: rec.etag } : {}),
          ...(typeof rec._v === 'number' ? { _v: rec._v } : {}),
        };
      },
      ...opts,
    });
  }

  return {
    read,
    write,
    delete: deleteResource,
    list,
    subscribe,
    writeFromPeer,
    flush,
    mode: modeForUri,
    setMode,
    fetchResourceSkill,

    // Phase 52.14 (Q-D) — event surface for conflict resolution.
    on,
    off,

    // Cache-mode V1 surface (Phase 52.8).
    drainWriteThroughQueue,
    listWriteThroughPending,
    writeThroughPendingCount,

    // Introspection
    get deviceId()      { return deviceId; },
    get backend()       { return backend; },
    get currentMode()   { return mode; },
    get _perUriMode()   { return new Map(perUriMode); },
    get _writeThroughQueue() { return writeThroughQueue; },
  };
}
