/**
 * IndexedDBPersist — Browser IndexedDB adapter for tasks-v0's
 * `CachingDataSource` local cache.
 *
 * Identical surface + semantics to `apps/pinboard/src/lib/IndexedDBPersist.js`.
 * Copied (not imported) to avoid an app→app dependency; the substrate
 * candidate is to lift the three adapters + `persistPicker` into
 * `@onderling/local-store` (rule-of-two now satisfied — see
 * `Project Files/Substrates/substrate-candidates.md`).
 *
 * Default `dbName` for tasks-v0 callers is `'tasks-cache'`; basis
 * web composition passes `{dbName:'cc-tasks-cache', storeName:'items'}`
 * to keep the IDB database isolated from pinboard's `'cc-pinboard-cache'`.
 *
 * See the pinboard original for the storage-shape rationale + browser-only
 * contract (`globalThis.indexedDB` is required).
 */

const DEFAULT_STORE_NAME = 'snapshots';
const SNAPSHOT_KEY       = 'state';

export class IndexedDBPersist {
  #dbName;
  #storeName;
  #saveDelayMs;
  #db = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #pendingTimer = null;
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

  // ── Public surface (mirrors FilePersist + AsyncStoragePersist) ───

  /**
   * Read the persisted snapshot (if any) and return the resulting Map.
   * Empty / missing → empty Map.  Corrupt JSON → empty Map (non-fatal).
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
      return new Map();
    }
  }

  /**
   * Write a Map to IndexedDB (single-key replace).
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
   * Schedule a debounced save.  Coalesces bursts into one transaction.
   *
   * @param {Map<string, any>} map
   */
  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      this.save(map).catch(() => { /* swallow — best-effort */ });
    }, this.#saveDelayMs);
  }

  /** Force any pending debounced save to flush now. */
  async flush(map) {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    await this.save(map);
  }

  /** Cancel any pending debounced save without saving. */
  cancel() {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
  }

  /** Close the IndexedDB connection. */
  close() {
    try { this.#db?.close?.(); } catch { /* defensive */ }
    this.#db = null;
  }

  // ── Internal: minimal raw-indexedDB wrapper ──────────────────────

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
    });
  }
}
