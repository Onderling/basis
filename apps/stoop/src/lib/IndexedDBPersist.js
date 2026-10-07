/**
 * IndexedDBPersist — Browser IndexedDB adapter for
 * `CachingDataSource`'s local cache.  Same surface as
 * `./FilePersist.js`, different backing store.
 *
 * Why we need this
 *   Stoop's V1 single-file `FilePersist` keeps the in-memory Map on
 *   disk so restarting the Node process doesn't wipe state.  When
 *   the Stoop agent boots in a BROWSER (basis web composition
 *   per `Project Files/basis/integration-plan-2026-05-23.md`),
 *   there is no `node:fs`.  This adapter uses IndexedDB instead.
 *
 *   The two adapters are interchangeable from `Agent.js`'s POV:
 *   same `load() / save() / scheduleSave() / flush() / cancel()`
 *   methods, same single-JSON-blob persistence pattern (one Map
 *   per database, matching FilePersist's one-Map-per-file).
 *
 * Storage shape
 *   Database:    opts.dbName  (default 'stoop-cache')
 *   Object store: 'snapshots'  (single store per database)
 *   Key:          'state'      (the Map's full serialised JSON)
 *
 *   We deliberately use ONE blob (not per-row records).  Stoop's
 *   cache is small (~kilobytes); blob writes are simpler + match
 *   FilePersist's atomic-replace semantics.
 *
 * Browser-only.  Throws on construction when `indexedDB` is missing.
 */

import { trackPendingSave } from '@onderling/local-store';

const DEFAULT_STORE_NAME = 'snapshots';
const SNAPSHOT_KEY       = 'state';

export class IndexedDBPersist {
  #dbName;
  #storeName;
  #saveDelayMs;
  #db = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #pendingTimer = null;
  #untrack = null;
  /** Most recent saved snapshot (for diffing / no-op skip). */
  #lastSerialised = null;

  /**
   * @param {object} args
   * @param {string} args.dbName                IndexedDB database name
   * @param {string} [args.storeName='snapshots']
   * @param {number} [args.saveDelayMs=200]     debounce window (ms)
   */
  constructor({ dbName, storeName = DEFAULT_STORE_NAME, saveDelayMs = 200 } = {}) {
    if (typeof dbName !== 'string' || !dbName) {
      throw new TypeError('IndexedDBPersist: dbName required');
    }
    if (typeof globalThis.indexedDB === 'undefined') {
      throw new Error('IndexedDBPersist: requires globalThis.indexedDB (browser-only)');
    }
    this.#dbName      = dbName;
    this.#storeName   = storeName;
    this.#saveDelayMs = saveDelayMs;
  }

  // ── Public surface (mirrors FilePersist) ──────────────────────────

  /**
   * Read the persisted snapshot (if any) and return the resulting Map.
   * Empty / missing → empty Map.  Corrupt JSON → empty Map (non-fatal,
   * matches FilePersist).
   *
   * @returns {Promise<Map<string, any>>}
   */
  async load() {
    try {
      const raw = await this.#get(SNAPSHOT_KEY);
      if (typeof raw !== 'string') return new Map();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return new Map();
      this.#lastSerialised = raw;
      return new Map(Object.entries(parsed));
    } catch {
      // Corrupt blob or open failure: treat as empty (matches
      // FilePersist's silent-recovery semantics).  Apps that want
      // strict mode can call `load()` directly + observe throws.
      return new Map();
    }
  }

  /**
   * Write a Map to IndexedDB.  Single-key replace; the prior blob
   * is overwritten in one transaction (analogue of FilePersist's
   * atomic write-temp-then-rename).
   *
   * @param {Map<string, any>} map
   */
  async save(map) {
    const obj        = Object.fromEntries(map);
    const serialised = JSON.stringify(obj);
    if (serialised === this.#lastSerialised) return;     // no-op skip
    await this.#put(SNAPSHOT_KEY, serialised);
    this.#lastSerialised = serialised;
  }

  /**
   * Schedule a debounced save.  Coalesces bursts of writes into one
   * transaction per debounce window.
   *
   * @param {Map<string, any>} map
   */
  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#untrack?.();
    const run = () => this.save(map).catch(() => { /* swallow — caller's onError handler is upstream */ });
    // tracked while it waits: a shell flushes it at once when the page or the app goes away
    this.#untrack = trackPendingSave(async () => {
      if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
      this.#untrack = null;
      await run();
    });
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      this.#untrack?.(); this.#untrack = null;
      run();
    }, this.#saveDelayMs);
  }

  /** Force any pending debounced save to flush now. */
  async flush(map) {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    this.#untrack?.(); this.#untrack = null;
    await this.save(map);
  }

  /** Cancel any pending debounced save without saving. */
  cancel() {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    this.#untrack?.(); this.#untrack = null;
  }

  /** Close the IndexedDB connection.  Optional — adapter survives
   *  process lifetime in browsers without explicit close. */
  close() {
    try { this.#db?.close?.(); } catch { /* defensive */ }
    this.#db = null;
  }

  // ── Internal: minimal raw-indexedDB wrapper ───────────────────────
  // We use raw indexedDB (no `idb` / `idb-keyval` dep) to keep
  // apps/stoop's bundle small — single-store + single-key access is
  // simple enough that the helper deps don't pay rent.

  async #open() {
    if (this.#db) return this.#db;
    this.#db = await new Promise((resolve, reject) => {
      const req = globalThis.indexedDB.open(this.#dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.#storeName)) {
          db.createObjectStore(this.#storeName);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
    return this.#db;
  }

  async #get(key) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.#storeName, 'readonly');
      const req = tx.objectStore(this.#storeName).get(key);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async #put(key, value) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.#storeName, 'readwrite');
      const req = tx.objectStore(this.#storeName).put(value, key);
      req.onsuccess = ()  => resolve();
      req.onerror   = (e) => reject(e.target.error);
      // Commit now: a save made on the way out of a page (the flush on pagehide) is otherwise abandoned with it.
      tx.commit?.();
    });
  }
}
