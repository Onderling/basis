import { storageName } from './storageRegister.js';   // every storage name from the one register
import { sealedKeyValue, onShellContentSeal } from './localStoreSeal.js';
/**
 * The attachment blob store — where a received file's BYTES live, which is never a snapshot.
 *
 * The three device stores (a circle's items, the device log, a contact's DM thread) are each persisted
 * as ONE serialised value per device. On Android that value is a single SQLite row behind a ~2 MB cursor
 * window, inside a database that defaults to 6 MB, and a read that exceeds the window does not throw to
 * the caller: the loader catches it and returns an EMPTY map, which the next debounced save then writes
 * back over the row. So a photo persisted inline does not merely fail to load — it takes the whole store
 * with it, silently and permanently. (Found 2026-09-03; the receive door shipped 09-02 was doing exactly
 * this, admitting 8 MB.)
 *
 * Hence the rule this module exists to keep: **a snapshot holds pointers, never bytes.** Each file's
 * payload is stored under its own key, in a medium that can hold it — IndexedDB on web (no per-value
 * ceiling worth naming), the filesystem on mobile (`attachmentBlobStoreRN.js`; per-key AsyncStorage
 * would NOT do, because one 4 MB value is still one oversized row).
 *
 * The surface is deliberately two methods, matching what `createAddressedDeliver` asks of it:
 *   put(id, dataB64) → store the payload under the file's id
 *   get(id)          → the payload, or null when it was never written / has been cleared
 *
 * Both are best-effort at the call site: a thread that shows a file card whose bytes are missing is
 * honest and recoverable; a thread that lost its messages is neither.
 */

const DB_NAME  = storageName('attachmentBlobs');
const STORE    = 'blobs';

/** Open (and create) the object store. Rejects when IndexedDB is unavailable — the caller degrades. */
function openDb(indexedDB) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error ?? new Error('indexedDB.open failed'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/**
 * The web attachment blob store, over IndexedDB.
 *
 * @param {object} [a]
 * @param {IDBFactory} [a.indexedDB]  injected for tests; defaults to the global
 * @returns {{put: Function, get: Function}} — null-safe: with no IndexedDB, `put` is a no-op and `get`
 *   returns null, so the thread still works and simply has no bytes to show.
 */
export function createAttachmentBlobStore({ indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) return { put: async () => {}, get: async () => null };
  let dbPromise = null;
  const db = () => (dbPromise ??= openDb(indexedDB));
  return {
    async put(id, dataB64) {
      if (!id || typeof dataB64 !== 'string' || !dataB64) return;
      try { await tx(await db(), 'readwrite', (os) => os.put(dataB64, String(id))); }
      catch { /* the turn persists regardless; the card renders from its description */ }
    },
    async get(id) {
      if (!id) return null;
      try { return await tx(await db(), 'readonly', (os) => os.get(String(id))); }
      catch { return null; }
    },
  };
}

/**
 * A blob store (this one on the web, `createAttachmentBlobStoreRN` on the phone) whose bytes are SEALED at rest with
 * the device's content key. Both shells build their store through this: a received file is a person's content as
 * much as the thread that points to it, which is sealed. The file's base64 is sealed as one value under its id, by
 * the same strict rule as every sealed key-value store: a put before the key WAITS for it (nothing is written plain),
 * and a stored file that will not open with this key reads as missing, never as its sealed text, and is not written
 * over.
 * @param {{put: Function, get: Function}} blobs
 * @returns {{put: Function, get: Function}} the same two methods; a failure costs the bytes, never the message
 */
export function sealedBlobStore(blobs) {
  const kv = sealedKeyValue({
    getItem: (id) => blobs.get(id),
    setItem: (id, v) => blobs.put(id, v),
    removeItem: async () => {},
  }, { name: storageName('attachmentBlobs'), strict: true, waitForKey: true, kind: 'messages' });
  const keyArrives = () => new Promise((resolve) => { onShellContentSeal(resolve); });
  return {
    async put(id, dataB64) {
      if (!id || typeof dataB64 !== 'string' || !dataB64) return;
      try { await keyArrives(); await kv.setItem(String(id), dataB64); }
      catch { /* the turn persists regardless; the card renders from its description */ }
    },
    async get(id) {
      if (!id) return null;
      try { return (await kv.getItem(String(id))) ?? null; } catch { return null; }
    },
  };
}
