/**
 * CachingDataSource — local-first DataSource that wraps an optional
 * remote / pod-backed DataSource with a Map cache + write queue.
 *
 * **2026-05-08:** lifted from `apps/stoop/src/lib/CachingDataSource.js`
 * (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 * Stoop's `lib/CachingDataSource.js` is now a re-export shim.
 *
 * Rationale (originally Stoop V1 Phase 4 — 2026-05-06):
 *   - The pod is the source of truth, the local cache is reality
 *     (per the project-wide rule in
 *     `Project Files/projects/README.md`).
 *   - The app must boot and run without an authenticated pod (the
 *     "Local-only mode is the floor" rule). Sign-in attaches a pod
 *     mid-session; the queue flushes automatically.
 *   - Pod outages must not block the UI. Writes always succeed
 *     locally; failed remote sync queues for retry.
 *
 * Composition:
 *   - `new CachingDataSource()`                   → pure local (no inner; works offline forever)
 *   - `new CachingDataSource({ inner: pod })`     → local + write-through to pod
 *   - `cache.attachInner(pod)`                    → swap inner mid-flight; auto-flushes
 *
 * Read path:
 *   - Always check local first.
 *   - If miss + inner present + online → fetch from inner; populate local; return.
 *   - Otherwise return null.
 *
 * Write / delete path:
 *   - Always mutate local.
 *   - Enqueue for inner (if inner present).
 *   - If online → attempt flush (best-effort; failure flips online → false).
 *
 * List / query: local only. Fresh data from inner is pulled by
 * `pullFromInner(prefix)` on the app's chosen cadence (typically
 * tied to foreground state by the host's clock — the foreground cadence on a phone).
 *
 * Events (Emitter): `online`, `offline`, `queued`, `flushed`, `pulled`, `error`,
 * `bulk-sync-started`, `bulk-sync-progress`, `bulk-sync-finished`.
 *
 * **Phase 34 (2026-05-06):** when `attachInner(pod)` is called
 * and the cache already holds locally-written data (the user posted
 * items / wrote settings before signing in), we walk the local Map
 * and enqueue a `write` for every non-local-only path before the
 * normal post-attach flush.  Without this step, pre-attach writes
 * would never reach the pod.
 *
 * **Phase 33+34 (2026-05-06):** the constructor now accepts
 * `localOnlyPrefixes: string[]` — write/delete to a path matching
 * any prefix mutates only the local Map, never queues for the
 * inner.  Bulk-sync also skips those paths.  Stoop uses this for:
 *   - `mem://stoop/settings/devices/`         (per-install settings)
 *   - `mem://stoop/settings/.migrated-from-v2` (one-shot marker)
 */

import { Emitter } from '@onderling/core';
import { DataSource } from '@onderling/core';

/** @typedef {{ op: 'write'|'delete', path: string, data?: any }} QueueEntry */

export class CachingDataSource extends DataSource {
  /** @type {Map<string, any>} */
  #local;
  /** @type {DataSource | null} */
  #inner;
  /** @type {QueueEntry[]} */
  #queue = [];
  /** @type {boolean} */
  #online;
  /** @type {Emitter} */
  #emitter = new Emitter();
  /** Optional persistence hook fired after every local mutation. */
  #onLocalChange = null;
  /** @type {string[]} — Phase 34: paths matching a prefix never sync to inner. */
  #localOnlyPrefixes = [];
  /** @type {(logicalPath: string) => string} — Phase 1: map a logical key/prefix → the inner DataSource's URI. Identity by default. */
  #toInner = (p) => p;
  /** @type {(innerUri: string) => string} — inverse of #toInner (read-back / list). Identity by default. */
  #fromInner = (u) => u;

  /**
   * @param {object} [opts]
   * @param {DataSource} [opts.inner]            optional inner DataSource (pod, etc.)
   * @param {Map<string, any>} [opts.localStore] optional local store (defaults to a fresh Map)
   * @param {boolean} [opts.online=true]         initial online state
   * @param {(map: Map<string, any>) => void} [opts.onLocalChange]
   *   Optional callback fired after every local-cache mutation
   *   (write / delete / pull).  Apps wire this to a `FilePersist`
   *   adapter to survive process restarts:
   *
   *     const persist = new FilePersist({ path });
   *     const cache = new CachingDataSource({
   *       inner, localStore: await persist.load(),
   *       onLocalChange: (m) => persist.scheduleSave(m),
   *     });
   * @param {string[]} [opts.localOnlyPrefixes]
   *   Paths matching ANY of these prefixes are never enqueued for
   *   the inner DataSource and are skipped during bulk-sync.  Used
   *   by Stoop to keep per-device settings + the migration marker
   *   off the pod.
   * @param {{toInner:(p:string)=>string, fromInner:(u:string)=>string}} [opts.innerKeyMap]
   *   Optional logical-key ↔ inner-URI mapper (Phase 1 pod-routing
   *   seam).  Defaults to identity → behaviour-neutral for every
   *   existing consumer.  When set, every call into the inner
   *   DataSource (flush write/delete, read, pullFromInner list+read)
   *   is translated; the local cache + queue stay keyed by the app's
   *   LOGICAL keys.  `toInner` must also handle list prefixes;
   *   `fromInner` is its inverse for read-back.
   */
  constructor({
    inner = null, localStore, online = true, onLocalChange,
    localOnlyPrefixes = [], innerKeyMap = null,
  } = {}) {
    super();
    this.#inner          = inner;
    this.#local          = localStore ?? new Map();
    this.#online         = online;
    this.#onLocalChange  = typeof onLocalChange === 'function' ? onLocalChange : null;
    this.#localOnlyPrefixes = Array.isArray(localOnlyPrefixes)
      ? localOnlyPrefixes.filter((p) => typeof p === 'string' && p.length > 0)
      : [];
    // Phase 1 (pod-routing seam): translate ONLY at the #inner
    // boundary.  Local cache + queue stay keyed by the app's logical
    // keys.  Default identity keeps Tasks / Stoop-no-pod byte-identical.
    if (innerKeyMap
        && typeof innerKeyMap.toInner === 'function'
        && typeof innerKeyMap.fromInner === 'function') {
      this.#toInner   = (p) => innerKeyMap.toInner(p);
      this.#fromInner = (u) => innerKeyMap.fromInner(u);
    }
  }

  /** True when the path matches any local-only prefix. */
  #isLocalOnly(path) {
    if (typeof path !== 'string' || this.#localOnlyPrefixes.length === 0) return false;
    for (const prefix of this.#localOnlyPrefixes) {
      if (path.startsWith(prefix)) return true;
    }
    return false;
  }

  /** Fire the persistence hook (best-effort). */
  #notifyLocalChange() {
    if (!this.#onLocalChange) return;
    try { this.#onLocalChange(this.#local); } catch { /* persistence is best-effort */ }
  }

  // ── Emitter passthrough ──────────────────────────────────────────────────

  on(name, handler)  { return this.#emitter.on(name, handler); }
  off(name, handler) { return this.#emitter.off?.(name, handler); }
  emit(name, payload) { return this.#emitter.emit(name, payload); }

  // ── State accessors ──────────────────────────────────────────────────────

  /** True when the cache has an inner DataSource AND it's reachable. */
  get isOnline() { return this.#online && this.#inner !== null; }

  /** True when an inner DataSource has been attached. */
  get hasInner() { return this.#inner !== null; }

  /** Number of pending queued ops (writes + deletes). */
  get queueLength() { return this.#queue.length; }

  /** Snapshot of the queue (read-only — do not mutate). */
  get queue() { return this.#queue.slice(); }

  // ── Lifecycle controls ───────────────────────────────────────────────────

  /**
   * Attach (or swap) the inner DataSource. Phase 34: when an
   * inner is attached AND the local cache already holds entries that
   * weren't queued (e.g. writes that happened before any inner was
   * present, or after a previous detach), walk the Map and enqueue a
   * `write` op for every non-local-only path that isn't already in
   * the queue.  Then run the normal flush so the queue lands on the
   * pod.
   *
   * Emits:
   *   - `bulk-sync-started` { total }      before the first push
   *   - `bulk-sync-progress` { done, total } after each batch
   *   - `bulk-sync-finished` { count, errored }  when done
   *
   * No-op when `inner` is null (detach) or already-attached and
   * already-flushed.  Local-only paths are skipped entirely.
   */
  async attachInner(inner) {
    const previous = this.#inner;
    this.#inner = inner ?? null;
    if (!this.#inner) return; // detach — nothing to do

    // Build the set of paths already in the queue so we don't double-
    // enqueue if attachInner is called twice in a row.
    const enqueued = new Set();
    for (const e of this.#queue) enqueued.add(`${e.op}:${e.path}`);

    // Walk the local Map for entries that should bulk-sync.
    const candidates = [];
    for (const [path, data] of this.#local) {
      if (this.#isLocalOnly(path)) continue;
      if (enqueued.has(`write:${path}`)) continue;
      candidates.push({ path, data });
    }

    if (candidates.length > 0) {
      this.#emitter.emit('bulk-sync-started', { total: candidates.length });
      for (const { path, data } of candidates) {
        this.#queue.push({ op: 'write', path, data });
      }
    }

    // Standard flush handles the queue (both pre-existing entries
    // and the new bulk-sync ones).  Stops on first error and flips
    // online → false; we report progress after either outcome.
    let replayed = 0;
    let errored = false;
    if (this.#online) {
      try {
        replayed = await this.flush();
      } catch (err) {
        errored = true;
        this.#emitter.emit('error', { error: err, op: { op: 'bulk-sync' } });
      }
      // flush() doesn't throw; it flips offline + emits 'error'.  If
      // the queue is non-empty after flush, we know it errored mid-
      // way through.
      if (this.#queue.length > 0) errored = true;
    }

    if (candidates.length > 0) {
      this.#emitter.emit('bulk-sync-progress', { done: replayed, total: candidates.length });
      this.#emitter.emit('bulk-sync-finished', { count: replayed, errored });
    }

    // Re-emit a transition signal so listeners can chain (e.g. UI
    // hides the progress bar even when previous === inner).
    if (previous !== inner) this.#emitter.emit('inner-attached', {});
  }

  /**
   * Toggle online state. Going online → flush queue. Going offline →
   * subsequent writes still succeed locally; queue grows until next online.
   */
  async setOnline(value) {
    const wasOnline = this.#online;
    this.#online = !!value;
    if (this.#online && !wasOnline) {
      this.#emitter.emit('online', {});
      await this.flush();
    } else if (!this.#online && wasOnline) {
      this.#emitter.emit('offline', {});
    }
  }

  /**
   * Best-effort drain of the queue against the inner DataSource. Stops
   * on the first failure and flips online → false. Returns the number
   * of ops successfully replayed.
   */
  async flush() {
    if (!this.#inner) return 0;
    let replayed = 0;
    while (this.#queue.length > 0) {
      const entry = this.#queue[0];
      try {
        if (entry.op === 'write')   await this.#inner.write(this.#toInner(entry.path), entry.data);
        if (entry.op === 'delete')  await this.#inner.delete(this.#toInner(entry.path));
        this.#queue.shift();
        replayed += 1;
      } catch (err) {
        // Stay in queue; flip offline; emit error.
        this.#online = false;
        this.#emitter.emit('error',   { error: err, op: entry });
        this.#emitter.emit('offline', { reason: 'flush-failed' });
        return replayed;
      }
    }
    if (replayed > 0) this.#emitter.emit('flushed', { count: replayed });
    return replayed;
  }

  /**
   * Pull paths matching `prefix` from the inner DataSource into the
   * local cache, replacing local entries. Used by the app's sync
   * cadence to refresh from the pod on a poll. Returns the number of
   * paths pulled.
   *
   * Best-effort: failure flips online → false and re-throws so the
   * caller can decide whether to surface a banner.
   */
  async pullFromInner(prefix = '') {
    if (!this.#inner) return 0;
    if (!this.#online) return 0;
    let count = 0;
    try {
      const innerPaths = await this.#inner.list(this.#toInner(prefix));
      for (const ip of innerPaths) {
        const v = await this.#inner.read(ip);
        if (v !== null) {
          this.#local.set(this.#fromInner(ip), v);
          count += 1;
        }
      }
      if (count > 0) this.#notifyLocalChange();
      this.#emitter.emit('pulled', { prefix, count });
      return count;
    } catch (err) {
      this.#online = false;
      this.#emitter.emit('error',   { error: err, op: { op: 'pull', prefix } });
      this.#emitter.emit('offline', { reason: 'pull-failed' });
      throw err;
    }
  }

  // ── DataSource interface ─────────────────────────────────────────────────

  async read(path) {
    if (this.#local.has(path)) return this.#local.get(path);
    if (!this.#inner || !this.#online) return null;
    try {
      const v = await this.#inner.read(this.#toInner(path));
      if (v !== null) {
        this.#local.set(path, v);
        this.#notifyLocalChange();
      }
      return v;
    } catch (err) {
      this.#online = false;
      this.#emitter.emit('error',   { error: err, op: { op: 'read', path } });
      this.#emitter.emit('offline', { reason: 'read-failed' });
      return null;
    }
  }

  async write(path, data) {
    this.#local.set(path, data);
    this.#notifyLocalChange();
    if (!this.#inner) return;
    if (this.#isLocalOnly(path)) return;     // Phase 34: skip pod sync for local-only paths
    this.#queue.push({ op: 'write', path, data });
    this.#emitter.emit('queued', { op: 'write', path, depth: this.#queue.length });
    if (this.#online) await this.flush();
  }

  async delete(path) {
    this.#local.delete(path);
    this.#notifyLocalChange();
    if (!this.#inner) return;
    if (this.#isLocalOnly(path)) return;     // Phase 34: skip pod sync for local-only paths
    this.#queue.push({ op: 'delete', path });
    this.#emitter.emit('queued', { op: 'delete', path, depth: this.#queue.length });
    if (this.#online) await this.flush();
  }

  async list(prefix = '') {
    const out = [];
    for (const key of this.#local.keys()) {
      if (key.startsWith(prefix)) out.push(key);
    }
    return out.sort();
  }

  async query(filter = {}) {
    // Mirrors MemorySource's query — the local cache is a Map of
    // path → JSON-encoded item.  Apps that want pod-side query must
    // call `pullFromInner` first; the cache is never authoritative
    // for "ask the pod for items I don't have".
    const results = [];
    for (const [path, value] of this.#local) {
      let parsed;
      try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      if (_matches(parsed, filter)) results.push({ path, ...parsed });
    }
    return results;
  }

  /** Number of locally-cached entries (testing / diagnostics). */
  get localSize() { return this.#local.size; }
}

function _matches(obj, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (obj[k] !== v) return false;
  }
  return true;
}
