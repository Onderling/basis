/**
 * IdentitySync — Track B / B3.
 *
 * Bidirectional sync engine between an `IdentityPodStore` (canonical, on
 * the pod) and a local `Vault` (live cache).  Pulls each known identity
 * resource container from the pod, decrypts via the IdentityPodStore, and
 * caches the decrypted JSON in the vault under the `identity-cache:` prefix.
 *
 * --- scheduling (Q-B.4, locked 2026-04-29) ---------------------------------
 *
 *   • interval polling — 5-minute default (configurable via `intervalMs`),
 *   • foreground trigger — `onForeground()` (RN: hook to `AppState 'active'`),
 *   • on-demand `sync.now({ priority, resources })` — security-critical
 *     operations (rotate key, revoke device) call this with
 *     `{ priority: 'security', resources: ['devices/', 'grants/issued/',
 *       'grants/held/'] }` first to refresh just those containers before
 *     proceeding.
 *
 * Concurrent `now()` calls coalesce onto a single in-flight promise so a
 * burst of triggers doesn't multiply pod traffic.
 *
 * --- known concurrency edge case (Q-B.3, locked 2026-04-29) ---------------
 *
 * Manifest writes inherit `IdentityPodStore`'s LWW-with-retry (max 3
 * retries) policy.  See the IdentityPodStore class JSDoc for the known
 * "two devices modify the SAME record in a tight window" case — the loser
 * sees a `ConflictError` from `writeResource` and is expected to retry.
 * IdentitySync's pull path is read-only against the pod, so it cannot
 * itself create new manifest conflicts; but a pull immediately followed
 * by a write from the consumer can race.  Consumers handle that the same
 * way they handle any `writeResource` `CONFLICT` — surface to caller.
 *
 * Vault cache shape:
 *
 *   identity-cache:<resourcePath>  → JSON-serialized { record, _etag, _lastModified, _syncedAt }
 *
 * Where `record` is the decrypted resource object (the same shape passed
 * to `IdentityPodStore.writeResource`).  `_etag` / `_lastModified` are
 * strings (or null) used to skip re-decoding if the pod's underlying
 * resource hasn't changed since the last pull.
 *
 * Tracked in `coding-plans/track-B-identity-sync.md` §B3.
 */

import { Emitter } from '@onderling/core';

const VAULT_CACHE_PREFIX = 'identity-cache:';

/** Default container paths walked on a full sync, in priority order. */
const DEFAULT_RESOURCES = Object.freeze([
  'devices/',
  'grants/issued/',
  'grants/held/',
  'contacts/',
  'app-permissions/',
  'recovery-hints.enc',
]);

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Build the vault cache key for a given resource path.
 *
 * @param {string} resourcePath  pod-relative, e.g. `'devices/device-x.enc'`.
 * @returns {string}
 */
export function vaultCacheKeyFor(resourcePath) {
  return `${VAULT_CACHE_PREFIX}${resourcePath}`;
}

/**
 * Strip the `identity-cache:` prefix to recover the resource path.  Returns
 * `null` if the key is not an identity-cache key.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function resourcePathFromCacheKey(key) {
  if (!key.startsWith(VAULT_CACHE_PREFIX)) return null;
  return key.slice(VAULT_CACHE_PREFIX.length);
}

/**
 * Bidirectional vault-pod sync.  Currently implements pod → vault pull;
 * vault → pod push happens through `IdentityPodStore.writeResource` calls
 * made directly by callers (e.g. `KeyRotation`, `GroupManager`).  This
 * class is the read-side cache that keeps the on-device working set
 * fresh.
 *
 * Emits:
 *   - `'synced'` `{ priority, pulls, pushes, conflicts, durationMs }`
 *   - `'error'`  `(err)` — caught from periodic ticks; manual `now()`
 *                          calls re-throw so callers can react.
 */
export class IdentitySync extends Emitter {
  /** @type {object} */ #vault;
  /** @type {object} */ #podStore;
  /** @type {object} */ #podClient;
  /** @type {number} */ #intervalMs;
  /** @type {ReturnType<typeof setTimeout>|null} */ #pollTimer = null;
  /** @type {boolean} */ #running = false;
  /** @type {Promise<object>|null} */ #inFlight = null;
  /** @type {{ pulls: number, pushes: number, conflicts: number, lastSyncAt: number|null }} */
  #stats = { pulls: 0, pushes: 0, conflicts: 0, lastSyncAt: null };

  /**
   * @param {object} opts
   * @param {object}   opts.vault       Vault-shaped object with get/set/delete/has/list.
   * @param {object}   opts.podStore    IdentityPodStore instance.
   * @param {object}   opts.podClient   PodClient instance (used for `list()`
   *                                     to walk identity containers).  Must
   *                                     be the same client `podStore` was
   *                                     constructed with.
   * @param {number}  [opts.intervalMs=300000]  Periodic poll interval (Q-B.4 default: 5 min).
   */
  constructor({ vault, podStore, podClient, intervalMs = FIVE_MINUTES_MS } = {}) {
    super();
    if (!vault || typeof vault.get !== 'function' || typeof vault.set !== 'function') {
      throw new Error('IdentitySync: vault is required (must be a Vault-shaped object)');
    }
    if (!podStore || typeof podStore.readResource !== 'function') {
      throw new Error('IdentitySync: podStore is required (must be an IdentityPodStore)');
    }
    if (!podClient || typeof podClient.list !== 'function') {
      throw new Error('IdentitySync: podClient is required (must expose list())');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('IdentitySync: intervalMs must be a positive number');
    }
    this.#vault       = vault;
    this.#podStore    = podStore;
    this.#podClient   = podClient;
    this.#intervalMs  = intervalMs;
  }

  /** Configured poll interval (ms). */
  get intervalMs() { return this.#intervalMs; }

  /** Is the periodic loop currently scheduled? */
  get running() { return this.#running; }

  /** Snapshot of cumulative sync stats. */
  get stats() { return { ...this.#stats }; }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start the periodic sync loop.  Triggers an immediate initial pull,
   * then schedules subsequent pulls every `intervalMs` after each one
   * completes (settle-then-wait, not fixed-rate — avoids overlapping
   * runs on slow networks).
   *
   * Idempotent: calling `start()` while already running is a no-op.
   */
  start() {
    if (this.#running) return;
    this.#running = true;
    // Kick off an immediate sync; ignore failures here — the 'error'
    // event is the listener's hook.
    this.now({ priority: 'startup' }).catch((err) => this.emit('error', err));
    this.#scheduleNextTick();
  }

  /**
   * Stop the periodic loop.  In-flight syncs are NOT cancelled — they
   * complete naturally, but no new periodic tick will be scheduled.
   * Idempotent.
   */
  stop() {
    this.#running = false;
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  /**
   * Foreground hook.  Wire to `AppState 'active'` on RN, or `visibilitychange`
   * on the web.  Triggers a fresh full sync.
   */
  onForeground() {
    this.now({ priority: 'foreground' }).catch((err) => this.emit('error', err));
  }

  /**
   * Trigger a sync immediately.  Concurrent calls coalesce onto the
   * same in-flight promise.
   *
   * Call before security-critical operations:
   *
   *   await identitySync.now({ priority: 'security',
   *                             resources: ['devices/', 'grants/issued/'] });
   *   // now safe to read devices / grants from the vault cache
   *
   * @param {object}   [opts]
   * @param {string}   [opts.priority='normal']  'security' | 'normal' |
   *                    'foreground' | 'startup' | 'periodic'.  Pure metadata —
   *                    surfaced on the `'synced'` event so listeners can
   *                    distinguish (e.g. avoid logging periodic ticks).
   * @param {string[]|null} [opts.resources=null]  If non-null, only walk
   *                    these container paths.  Each entry must end in `/`
   *                    (container) or `.enc` (single resource).  Defaults to
   *                    the full identity container (`DEFAULT_RESOURCES`).
   * @returns {Promise<{ pulls: number, pushes: number, conflicts: number, durationMs: number }>}
   */
  now({ priority = 'normal', resources = null } = {}) {
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.#runOnce({ priority, resources }).finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  #scheduleNextTick() {
    if (!this.#running) return;
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null;
      if (!this.#running) return;
      this.now({ priority: 'periodic' })
        .catch((err) => this.emit('error', err))
        .finally(() => this.#scheduleNextTick());
    }, this.#intervalMs);
  }

  /** Internal single-cycle runner (no coalescing). */
  async #runOnce({ priority, resources }) {
    const startedAt = Date.now();
    const targets = resources ?? DEFAULT_RESOURCES;
    if (!Array.isArray(targets)) {
      throw new Error('IdentitySync.now: resources must be an array of paths or null');
    }

    let pulls = 0;
    let pushes = 0;        // reserved — vault → pod push lands when callers
    let conflicts = 0;     //            queue offline writes (TODO B3-step-4).

    for (const target of targets) {
      if (typeof target !== 'string' || target.length === 0) {
        throw new Error(`IdentitySync.now: invalid resource path '${target}'`);
      }
      try {
        if (target.endsWith('/')) {
          pulls += await this.#pullContainer(target);
        } else if (target.endsWith('.enc')) {
          pulls += await this.#pullResource(target);
        } else {
          throw new Error(`IdentitySync.now: resource path must end in '/' or '.enc' (got '${target}')`);
        }
      } catch (err) {
        // NOT_FOUND on an empty container is not an error — treat as zero pulls.
        if (err?.code === 'NOT_FOUND') continue;
        throw err;
      }
    }

    const durationMs = Date.now() - startedAt;
    this.#stats.pulls      += pulls;
    this.#stats.pushes     += pushes;
    this.#stats.conflicts  += conflicts;
    this.#stats.lastSyncAt  = Date.now();

    const result = { priority, pulls, pushes, conflicts, durationMs };
    this.emit('synced', result);
    return result;
  }

  /**
   * Walk a container path and pull each `.enc` resource into the vault
   * cache.  Returns the number of resources actually decoded (cache
   * misses or stale-etag — fresh hits are skipped).
   */
  async #pullContainer(containerRelPath) {
    const containerUri = this.#joinPodUri(containerRelPath);

    let listing;
    try {
      listing = await this.#podClient.list(containerUri, { recursive: false });
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return 0;
      throw err;
    }

    let touched = 0;
    for (const entry of listing?.entries ?? []) {
      // Only resources, not sub-containers.  Sub-containers (e.g. grants/)
      // get their own targets in DEFAULT_RESOURCES.
      if (entry.type === 'container') continue;
      // Only encrypted identity records.  Skip manifest, auth-log/, etc.
      if (!entry.uri.endsWith('.enc')) continue;
      const resourceRelPath = this.#relativeFromUri(entry.uri);
      if (!resourceRelPath) continue;
      const pulled = await this.#pullResource(resourceRelPath, entry);
      touched += pulled;
    }
    return touched;
  }

  /**
   * Pull a single `.enc` resource.  Returns 1 if the vault cache was
   * updated, 0 if the cached entry is already current (matching etag /
   * lastModified).
   *
   * @param {string} resourceRelPath  pod-relative, e.g. `'devices/device-x.enc'`.
   * @param {object} [listEntry]      optional list entry from `podClient.list`,
   *                                   used for etag/lastModified hint.  When
   *                                   present, we can skip the read entirely
   *                                   if the cached entry already matches.
   */
  async #pullResource(resourceRelPath, listEntry = null) {
    const cacheKey = vaultCacheKeyFor(resourceRelPath);
    const cached = await this.#readCachedEntry(cacheKey);

    // Fast path: list-entry tells us nothing changed since last pull.
    if (cached && listEntry && this.#entryMatches(cached, listEntry)) {
      return 0;
    }

    let record;
    let podMeta = { etag: null, lastModified: null };
    try {
      record = await this.#podStore.readResource(resourceRelPath);
      // The pod-client read returned to readResource doesn't surface up
      // through that helper, so we re-read meta from the listing if any.
      if (listEntry) {
        podMeta = {
          etag:         listEntry.etag         ?? null,
          lastModified: listEntry.lastModified ?? null,
        };
      }
    } catch (err) {
      if (err?.code === 'NOT_FOUND') {
        // Resource was removed on the pod — drop from cache too.
        if (cached) await this.#vault.delete(cacheKey);
        return cached ? 1 : 0;
      }
      throw err;
    }

    // Skip vault write if the decoded record is byte-identical to the
    // cached one (idempotent re-pulls don't dirty the cache).
    if (cached && this.#recordsEqual(cached.record, record)) {
      return 0;
    }

    const cacheEntry = {
      record,
      _etag:         podMeta.etag,
      _lastModified: podMeta.lastModified,
      _syncedAt:     new Date().toISOString(),
    };
    await this.#vault.set(cacheKey, JSON.stringify(cacheEntry));
    return 1;
  }

  async #readCachedEntry(cacheKey) {
    const raw = await this.#vault.get(cacheKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Corrupt cache entry — treat as a miss; will be overwritten.
      return null;
    }
  }

  #entryMatches(cached, listEntry) {
    if (listEntry.etag && cached._etag && listEntry.etag === cached._etag) {
      return true;
    }
    if (listEntry.lastModified && cached._lastModified
        && listEntry.lastModified === cached._lastModified) {
      return true;
    }
    return false;
  }

  /**
   * Cheap deep-equality for plain JSON records.  Stable-keys JSON encode
   * and compare strings — order-insensitive (records re-serialized after
   * round-trip can have key reorderings).
   */
  #recordsEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  // ── URI helpers ──────────────────────────────────────────────────────────

  #joinPodUri(relativePath) {
    const root = this.#podStore.root; // ends in '/onderling/' (or '/canopy/' for a pre-rename container)
    let rel = relativePath;
    while (rel.startsWith('/')) rel = rel.slice(1);
    return root + rel;
  }

  /** Strip the pod root (`<base>/canopy/`) from an absolute URI. */
  #relativeFromUri(uri) {
    const root = this.#podStore.root;
    if (!uri.startsWith(root)) return null;
    return uri.slice(root.length);
  }
}

// ── stable JSON ──────────────────────────────────────────────────────────────

/**
 * Stringify with sorted keys at every object level.  Used for record
 * equality checks; not exposed.
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export { DEFAULT_RESOURCES, VAULT_CACHE_PREFIX };
