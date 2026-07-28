/**
 * IndexedDBTombstones — browser-side `TombstoneStore` backed by IndexedDB.
 *
 * Schema: a single object store keyed by `uri`, value `{ at: number }`.
 *
 * Mirrors the open/transact pattern used by `IndexedDBSource` in
 * `@onderling/core`.  Not available in Node.js — will throw if
 * `indexedDB` is absent at construction-time `add`/`has`/etc.
 */
import { TombstoneStore } from '../TombstoneStore.js';

const DEFAULT_DB_NAME    = 'onderling-pod-client';
const DEFAULT_STORE_NAME = 'tombstones';

/**
 * Browser-side `TombstoneStore` backed by IndexedDB: a single object store keyed by `uri`, value
 * `{ at: number }`. Throws on first operation (`add`/`has`/...) when `indexedDB` is unavailable.
 */
export class IndexedDBTombstones extends TombstoneStore {
  #dbName;
  #storeName;
  #db = null;

  /**
   * @param {object} [opts]
   * @param {string} [opts.dbName='onderling-pod-client']
   * @param {string} [opts.storeName='tombstones']
   */
  constructor({ dbName = DEFAULT_DB_NAME, storeName = DEFAULT_STORE_NAME } = {}) {
    super();
    this.#dbName    = dbName;
    this.#storeName = storeName;
  }

  async #open() {
    if (this.#db) return this.#db;
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDBTombstones: indexedDB is not available in this environment');
    }
    this.#db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.#dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.#storeName)) {
          db.createObjectStore(this.#storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return this.#db;
  }

  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(this.#storeName, mode);
      const store = tx.objectStore(this.#storeName);
      const req   = fn(store);
      if (req && typeof req.onsuccess !== 'undefined') {
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => reject(req.error);
      } else {
        tx.oncomplete = () => resolve(null);
        tx.onerror    = () => reject(tx.error);
      }
    });
  }

  async add(uri, { at } = {}) {
    await this.#tx('readwrite', (s) => s.put({ at: at ?? Date.now() }, uri));
  }

  async has(uri) {
    const v = await this.#tx('readonly', (s) => s.get(uri));
    return v != null;
  }

  async remove(uri) {
    await this.#tx('readwrite', (s) => s.delete(uri));
  }

  async list() {
    const keys = await this.#tx('readonly', (s) => s.getAllKeys());
    const vals = await this.#tx('readonly', (s) => s.getAll());
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      out.push({ uri: keys[i], at: vals[i]?.at ?? 0 });
    }
    return out;
  }

  async close() {
    if (this.#db) {
      try { this.#db.close(); } catch { /* swallow */ }
      this.#db = null;
    }
  }
}
