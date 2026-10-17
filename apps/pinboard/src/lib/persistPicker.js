/**
 * persistPicker — pick the right cache-persistence adapter for the
 * runtime, so `Agent.js` doesn't hard-import the node-only
 * `FilePersist` (which breaks browser composition).
 *
 * Three adapters today, same interface:
 *   - `FilePersist`           Node:    `{path: '/data/pinboard.json'}`
 *   - `IndexedDBPersist`      Browser: `{dbName: 'pinboard-cache'}`
 *   `AsyncStoragePersist` RN: `{dbName, asyncStorage}`
 *
 * Callers pass exactly ONE of these.  The picker validates +
 * dynamically imports the matching adapter so a browser bundle
 * never pulls in `node:fs/promises`.
 *
 * # Why a picker (not just "use what's available")
 *
 * Node tests + the existing CLI deliberately use FilePersist; the
 * browser basis integration deliberately uses IndexedDB.  We
 * don't want auto-detect picking the "wrong" one based on
 * environment alone — that hides intent.  Caller declares; picker
 * just validates + lazy-loads.
 */

/**
 * @param {object}  args
 * @param {string}  [args.path]                  → FilePersist (Node)
 * @param {string}  [args.dbName]                → IndexedDBPersist (browser) OR AsyncStoragePersist (when args.asyncStorage also passed)
 * @param {object}  [args.asyncStorage]          → triggers AsyncStoragePersist (RN; requires args.dbName)
 * @param {string}  [args.storeName]             IndexedDB-only
 * @param {string}  [args.prefix]                AsyncStorage-only (key prefix; default 'pinboard-cache:')
 * @param {number}  [args.saveDelayMs]           applies to all three
 * @returns {Promise<{ persist: object, kind: 'file' | 'idb' | 'async' } | null>}
 *   Returns null when none is set (caller wanted in-memory only).
 */
export async function pickPersist(args = {}) {
  const hasFile  = typeof args.path === 'string' && args.path;
  const hasDb    = typeof args.dbName === 'string' && args.dbName;
  const hasAsync = !!args.asyncStorage;

  // Mutually exclusive — bail loud rather than silently picking.
  if (hasFile && (hasDb || hasAsync)) {
    throw new TypeError(
      'pickPersist: pass EITHER {path} (FilePersist) OR {dbName} ' +
      '(IndexedDBPersist) OR {dbName, asyncStorage} (AsyncStoragePersist), not a combination.',
    );
  }

  if (hasFile) {
    const { FilePersist } = await import('./FilePersist.js');
    return {
      kind:    'file',
      persist: new FilePersist({
        path:        args.path,
        saveDelayMs: args.saveDelayMs,
      }),
    };
  }
  if (hasAsync) {
    // RN path: {asyncStorage, dbName} → AsyncStoragePersist.
    // dbName is REQUIRED here (it becomes part of the AsyncStorage key).
    if (!hasDb) {
      throw new TypeError(
        'pickPersist: {asyncStorage} requires {dbName} (used as the AsyncStorage key namespace).',
      );
    }
    const { AsyncStoragePersist } = await import('./AsyncStoragePersist.js');
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
    const { IndexedDBPersist } = await import('./IndexedDBPersist.js');
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
