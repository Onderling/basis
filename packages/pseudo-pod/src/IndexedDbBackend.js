/**
 * IndexedDbBackend — a persistent `StorageBackend` backed by the
 * browser's IndexedDB.
 *
 * ⚠️ BROWSER-ONLY (per the portability convention, the filename carries
 * `IndexedDb`). It references `globalThis.indexedDB` (or an injected
 * factory) lazily, so it never touches `node:`/RN builtins — but it is
 * still platform-specific and, like `NodeFsBackend`, is deliberately
 * NOT re-exported from the package's portable `index.js`. Import it from
 * the dedicated subpath instead:
 *
 *     import { createIndexedDbBackend } from '@onderling/pseudo-pod/browser'
 *
 * It is the WEB sibling of `NodeFsBackend` (Node) and the RN
 * AsyncStorage/FS backends (`@onderling/react-native/pseudo-pod-adapter`):
 * a **general-purpose, opt-in** persistent alternative to
 * `MemoryBackend` so a browser consumer's circle data (RAG vectors +
 * circle items) — and the cache-mode write-through queue — SURVIVE A
 * PAGE RELOAD instead of dying with the ephemeral in-memory Map. This
 * is the missing web leg of restart-survival (Objective L). The one-line
 * swap in the app wiring (`createMemoryBackend()` →
 * `createIndexedDbBackend()`) is a separate follow-up.
 *
 * Contract: a drop-in `StorageBackend` (see `StorageBackend.js`) — the
 * `get/put/delete/list` + in-process `subscribe/listDirty/
 * subscribeDirty` surface, with semantics IDENTICAL to `MemoryBackend`
 * and `NodeFsBackend` (new key `_v=1`, increment on put unless the
 * caller pins `_v`; caller-supplied etag preserved, else a fresh one is
 * assigned; absent key → `get` returns `null`, `delete` is a no-op;
 * `list(prefix)` returns the sorted keys whose string starts with
 * `prefix`).
 *
 * Persistence model:
 *   - One object-store record per key, stored under the key itself
 *     (out-of-line IDB key). The record is `{ etag, v, bytes }`.
 *   - `bytes` is stored via IndexedDB's native structured-clone, so
 *     Uint8Array / ArrayBuffer / nested-binary values round-trip
 *     WITHOUT the base64 tagging `NodeFsBackend` needs for JSON — the
 *     returned value keeps the same type it went in as (matching
 *     `MemoryBackend`'s store-as-is behaviour rather than
 *     `NodeFsBackend`'s ArrayBuffer→Uint8Array coercion).
 *   - `_v` is stored in the record, so the Lamport counter survives a
 *     reload (the whole point).
 *
 * V1 simplifications (documented, deliberate — parity with
 * `NodeFsBackend`):
 *   - `subscribe`/`subscribeDirty`/the dirty-set are in-process only.
 *     A reloaded page re-attaches subscribers on boot; the durable
 *     signal is the persisted records themselves.
 *   - `list(prefix)` is an O(n) key scan — fine at circle scale; a
 *     key-range index is future work if a large-N consumer appears.
 *   - Single-writer assumption: one tab per `dbName`. Concurrent
 *     cross-tab writers are out of scope for V1.
 *
 * @typedef {import('./StorageBackend.js').StoredRecord} StoredRecord
 * @typedef {import('./StorageBackend.js').StorageBackend} StorageBackend
 * @typedef {import('./StorageBackend.js').BackendEvent} BackendEvent
 */

const DEFAULT_DB_NAME    = 'onderling-pseudo-pod';
const DEFAULT_STORE_NAME = 'records';

/**
 * Create a browser IndexedDB-backed `StorageBackend`.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbName='onderling-pseudo-pod']  IndexedDB database name.
 * @param {string} [opts.storeName='records']         object-store name.
 * @param {IDBFactory} [opts.indexedDB]               injectable factory
 *   (defaults to `globalThis.indexedDB`; injectable for tests +
 *   non-standard hosts).
 * @param {string} [opts.etagPrefix='idb']            prefix for generated etags.
 * @returns {StorageBackend & { _size: () => Promise<number>, close: () => void }}
 */
export function createIndexedDbBackend({
  dbName = DEFAULT_DB_NAME,
  storeName = DEFAULT_STORE_NAME,
  indexedDB = globalThis.indexedDB,
  etagPrefix = 'idb',
} = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    throw Object.assign(
      new Error('createIndexedDbBackend: requires globalThis.indexedDB (browser-only)'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  /** @type {Set<(e: BackendEvent) => void>} */
  const generalSubscribers = new Set();
  /** @type {Map<string, Set<(e: BackendEvent) => void>>} */
  const prefixSubscribers = new Map();
  /** @type {Set<(e: BackendEvent) => void>} */
  const dirtySubscribers = new Set();
  /** @type {Set<string>} */
  const dirty = new Set();

  let etagCounter = 0;
  const nextEtag = () =>
    `"${etagPrefix}-${Date.now().toString(36)}-${(++etagCounter).toString(36)}"`;

  /** Cached open-db promise (one connection per backend instance). */
  let dbPromise = null;
  function _open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  /** Run `fn(store)` inside a txn; resolve with `fn`'s request result. */
  async function _tx(mode, fn) {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      const req = fn(store);
      if (req) req.onsuccess = (e) => { result = e.target.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error);
    });
  }

  async function _readRecord(key) {
    const rec = await _tx('readonly', (store) => store.get(key));
    return rec == null ? null : rec;
  }

  function _fanOut(event) {
    for (const cb of generalSubscribers) {
      try { cb(event); } catch (_err) { /* swallow — substrate-internal */ }
    }
    for (const [prefix, subs] of prefixSubscribers) {
      if (event.key.startsWith(prefix)) {
        for (const cb of subs) {
          try { cb(event); } catch (_err) { /* swallow */ }
        }
      }
    }
  }

  function _fanOutDirty(event) {
    for (const cb of dirtySubscribers) {
      try { cb(event); } catch (_err) { /* swallow */ }
    }
  }

  return {
    async get(key) {
      const rec = await _readRecord(key);
      if (!rec) return null;
      return {
        bytes: rec.bytes,
        ...(rec.etag != null ? { etag: rec.etag } : {}),
        ...(typeof rec.v === 'number' ? { _v: rec.v } : {}),
      };
    },

    async put(key, bytes, etag, _v) {
      const prev = await _readRecord(key);
      const finalEtag = etag ?? nextEtag();
      // Lamport: pin to caller's _v when supplied (accept-peer-write
      // path), otherwise increment from local. New key starts at 1.
      const finalV = typeof _v === 'number'
        ? _v
        : ((prev && typeof prev.v === 'number' ? prev.v : 0) + 1);
      const record = { etag: finalEtag, v: finalV, bytes };
      await _tx('readwrite', (store) => store.put(record, key));
      _fanOut({ op: 'put', key, etag: finalEtag, _v: finalV });
      return { etag: finalEtag, _v: finalV };
    },

    async delete(key) {
      const existed = (await _readRecord(key)) != null;
      if (existed) {
        await _tx('readwrite', (store) => store.delete(key));
        _fanOut({ op: 'delete', key });
      }
      if (dirty.has(key)) {
        dirty.delete(key);
        _fanOutDirty({ op: 'clean', key });
      }
    },

    async list(prefix) {
      const keys = await _tx('readonly', (store) => store.getAllKeys());
      const out = [];
      for (const k of keys || []) {
        if (typeof k === 'string' && k.startsWith(prefix)) out.push(k);
      }
      out.sort();
      return out;
    },

    subscribe(prefix, cb) {
      if (typeof prefix !== 'string') {
        generalSubscribers.add(prefix);          // subscribe(cb) shorthand
        return () => { generalSubscribers.delete(prefix); };
      }
      if (typeof cb !== 'function') {
        throw Object.assign(
          new Error('subscribe: callback must be a function'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      let subs = prefixSubscribers.get(prefix);
      if (!subs) { subs = new Set(); prefixSubscribers.set(prefix, subs); }
      subs.add(cb);
      return () => {
        subs.delete(cb);
        if (subs.size === 0) prefixSubscribers.delete(prefix);
      };
    },

    async listDirty() {
      return [...dirty].sort();
    },

    subscribeDirty(cb) {
      if (typeof cb !== 'function') {
        throw Object.assign(
          new Error('subscribeDirty: callback must be a function'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      dirtySubscribers.add(cb);
      return () => { dirtySubscribers.delete(cb); };
    },

    // ── Test/internal helpers (parity with Memory/NodeFsBackend) ────
    async _size() {
      const n = await _tx('readonly', (store) => store.count());
      return typeof n === 'number' ? n : 0;
    },
    _markDirty(key) {
      if (!dirty.has(key)) {
        dirty.add(key);
        _fanOutDirty({ op: 'dirty', key });
      }
    },
    _markClean(key) {
      if (dirty.has(key)) {
        dirty.delete(key);
        _fanOutDirty({ op: 'clean', key });
      }
    },

    /** Close the IndexedDB connection. Optional — a backend survives
     *  page lifetime without an explicit close. */
    close() {
      if (!dbPromise) return;
      const p = dbPromise;
      dbPromise = null;
      p.then((db) => { try { db.close(); } catch { /* defensive */ } })
       .catch(() => { /* open failed — nothing to close */ });
    },
  };
}
