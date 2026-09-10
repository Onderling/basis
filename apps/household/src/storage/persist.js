/**
 * persist — OBJ-2 S1e — restart-survival for the household store.
 *
 * Household state today lives in an in-memory `MemorySource` (see
 * `InMemoryStore`) and is lost on reload.  This helper builds a
 * `@onderling/local-store` `CachingDataSource` backed by a runtime-picked
 * persist adapter so callers can inject it into
 * `new InMemoryStore({ dataSource })` and have items survive a fresh
 * process / page reload.
 *
 * Faithful to tasks-v0's `storage/buildBundle.js` async-persist path —
 * but household needs only the DataSource, not tasks' full
 * attach/detach bundle, so `buildHouseholdDataSource` returns the
 * `CachingDataSource` directly.
 *
 * The three persist adapters (File / IndexedDB / AsyncStorage) + the
 * picker are duplicated from tasks-v0 / stoop by DESIGN: importing
 * across apps (`apps/tasks-v0/...`) is forbidden, and the adapters do
 * not (yet) live in `@onderling/local-store`.  When a later slice lifts
 * them into the substrate, this file collapses to a thin re-use.  The
 * adapters here are byte-for-byte the same surface + semantics as
 * tasks-v0's `storage/persist/*` so behaviour is identical.
 */

import { CachingDataSource, sealedPersist } from '@onderling/local-store';

/**
 * Build a persistent household DataSource from a `persistDb` descriptor.
 *
 * Returns `null` when `persistDb` is falsy — the caller then falls back
 * to `InMemoryStore`'s default in-memory `MemorySource` (no persistence,
 * unchanged legacy behaviour).
 *
 * Otherwise: pick the right adapter, load any prior snapshot into the
 * cache Map, wire `onLocalChange → persist.scheduleSave` for
 * restart-survival, and return the `CachingDataSource`.
 *
 * @param {object} [persistDb]   pass exactly one of:
 *   - `{path}`                  → FilePersist (Node)
 *   - `{dbName, storeName?}`    → IndexedDBPersist (browser)
 *   - `{dbName, asyncStorage}`  → AsyncStoragePersist (RN)
 * @param {object} [opts]
 * @param {{seal:Function, open:Function}|null} [opts.strategy]  this device's content-seal strategy —
 *   what makes the persisted copy unreadable without the key. Omit for the previous, plaintext behaviour.
 * @returns {Promise<CachingDataSource|null>}
 */
export async function buildHouseholdDataSource(persistDb, { strategy = null } = {}) {
  if (!persistDb || typeof persistDb !== 'object') return null;

  const picked = await pickPersist(persistDb);
  if (!picked) return null; // no path/dbName → caller uses in-memory

  // At rest, the adapter writes ciphertext; the cache above it stays plaintext, so `query()` still
  // parses and filters. Without a strategy the adapter is returned unchanged — a host with no content
  // key behaves exactly as it did, rather than half-sealing. See `sealedPersist`.
  const persist = sealedPersist(picked.persist, strategy);
  const localStore = await persist.load();

  return new CachingDataSource({
    localStore,
    onLocalChange: (m) => persist.scheduleSave(m),
  });
}

/**
 * Pick the right cache-persistence adapter for the runtime so the
 * browser bundle never hard-imports the node-only `FilePersist`.
 * Mirrors tasks-v0's `storage/persist/persistPicker.js`.
 *
 * @param {object}  args
 * @param {string}  [args.path]          → FilePersist (Node)
 * @param {string}  [args.dbName]        → IndexedDBPersist OR AsyncStoragePersist
 * @param {object}  [args.asyncStorage]  → triggers AsyncStoragePersist (requires dbName)
 * @param {string}  [args.storeName]     IndexedDB-only
 * @param {string}  [args.prefix]        AsyncStorage-only
 * @param {number}  [args.saveDelayMs]
 * @returns {Promise<{ persist: object, kind: 'file'|'idb'|'async' } | null>}
 */
async function pickPersist(args = {}) {
  const hasFile  = typeof args.path === 'string' && args.path;
  const hasDb    = typeof args.dbName === 'string' && args.dbName;
  const hasAsync = !!args.asyncStorage;

  if (hasFile && (hasDb || hasAsync)) {
    throw new TypeError(
      'buildHouseholdDataSource: pass EITHER {path} (Node) OR {dbName} ' +
      '(browser) OR {dbName, asyncStorage} (RN), not a combination.',
    );
  }

  if (hasFile) {
    return {
      kind:    'file',
      persist: new FilePersist({ path: args.path, saveDelayMs: args.saveDelayMs }),
    };
  }
  if (hasAsync) {
    if (!hasDb) {
      throw new TypeError(
        'buildHouseholdDataSource: {asyncStorage} requires {dbName} (the key namespace).',
      );
    }
    return {
      kind:    'async',
      persist: new AsyncStoragePersist({
        dbName:       args.dbName,
        prefix:       args.prefix,
        saveDelayMs:  args.saveDelayMs,
        asyncStorage: args.asyncStorage,
      }),
    };
  }
  if (hasDb) {
    return {
      kind:    'idb',
      persist: new IndexedDBPersist({
        dbName:      args.dbName,
        storeName:   args.storeName,
        saveDelayMs: args.saveDelayMs,
      }),
    };
  }
  return null;
}

/* ───────────────────────── persist adapters ─────────────────────────
 * Same surface + semantics as tasks-v0/stoop's `storage/persist/*`:
 *   load() → Map, save(map), scheduleSave(map), flush(map), cancel(),
 *   close().  Copied (not imported) to avoid an app→app dependency. */

/** Node `fs` adapter (atomic write via tmp + rename). */
class FilePersist {
  #path; #saveDelayMs;
  #pendingTimer = null;
  #lastSerialised = null;

  constructor({ path, saveDelayMs = 200 } = {}) {
    if (typeof path !== 'string' || !path) throw new TypeError('FilePersist: path required');
    this.#path        = path;
    this.#saveDelayMs = saveDelayMs;
  }

  async load() {
    const { readFile } = await import('node:fs/promises');
    try {
      const raw    = await readFile(this.#path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return new Map();
      this.#lastSerialised = raw;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  async save(map) {
    const { writeFile, mkdir, rename } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const serialised = JSON.stringify(Object.fromEntries(map));
    if (serialised === this.#lastSerialised) return;
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    await writeFile(tmp, serialised, 'utf-8');
    await rename(tmp, this.#path);
    this.#lastSerialised = serialised;
  }

  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      this.save(map).catch(() => { /* best-effort */ });
    }, this.#saveDelayMs);
  }

  async flush(map) {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    await this.save(map);
  }

  cancel() {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
  }

  close() { this.cancel(); }
}

/** Browser IndexedDB adapter (single-key snapshot). */
class IndexedDBPersist {
  #dbName; #storeName; #saveDelayMs;
  #db = null;
  #pendingTimer = null;
  #lastSerialised = null;
  static #SNAPSHOT_KEY = 'state';

  constructor({ dbName, storeName = 'snapshots', saveDelayMs = 200 } = {}) {
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

  async load() {
    try {
      const raw = await this.#get(IndexedDBPersist.#SNAPSHOT_KEY);
      if (typeof raw !== 'string') return new Map();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return new Map();
      this.#lastSerialised = raw;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  async save(map) {
    const serialised = JSON.stringify(Object.fromEntries(map));
    if (serialised === this.#lastSerialised) return;
    await this.#put(IndexedDBPersist.#SNAPSHOT_KEY, serialised);
    this.#lastSerialised = serialised;
  }

  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      this.save(map).catch(() => { /* best-effort */ });
    }, this.#saveDelayMs);
  }

  async flush(map) {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    await this.save(map);
  }

  cancel() {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
  }

  close() {
    try { this.#db?.close?.(); } catch { /* defensive */ }
    this.#db = null;
  }

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
      const req = db.transaction(this.#storeName, 'readonly').objectStore(this.#storeName).get(key);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async #put(key, value) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.#storeName, 'readwrite').objectStore(this.#storeName).put(value, key);
      req.onsuccess = ()  => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  }
}

/** React Native AsyncStorage adapter (single-key snapshot). */
class AsyncStoragePersist {
  #key; #saveDelayMs; #storage;
  #pendingTimer = null;
  #lastSerialised = null;

  constructor({ dbName, prefix = 'household-cache:', saveDelayMs = 200, asyncStorage } = {}) {
    if (typeof dbName !== 'string' || !dbName) {
      throw new TypeError('AsyncStoragePersist: dbName required');
    }
    if (asyncStorage) {
      this.#storage = asyncStorage;
    } else {
      // Lazy require so vitest can import this module without an
      // AsyncStorage polyfill (same pattern tasks-v0/stoop use).
      // eslint-disable-next-line global-require
      this.#storage = require('@react-native-async-storage/async-storage').default;
    }
    if (!this.#storage || typeof this.#storage.getItem !== 'function') {
      throw new Error('AsyncStoragePersist: requires an AsyncStorage with getItem/setItem/removeItem');
    }
    this.#key         = `${prefix}${dbName}::state`;
    this.#saveDelayMs = saveDelayMs;
  }

  async load() {
    try {
      const raw = await this.#storage.getItem(this.#key);
      if (typeof raw !== 'string') return new Map();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return new Map();
      this.#lastSerialised = raw;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  async save(map) {
    const serialised = JSON.stringify(Object.fromEntries(map));
    if (serialised === this.#lastSerialised) return;
    await this.#storage.setItem(this.#key, serialised);
    this.#lastSerialised = serialised;
  }

  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      this.save(map).catch(() => { /* best-effort */ });
    }, this.#saveDelayMs);
  }

  async flush(map) {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    await this.save(map);
  }

  cancel() {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
  }

  close() { /* no-op — AsyncStorage holds no connection state */ }
}
