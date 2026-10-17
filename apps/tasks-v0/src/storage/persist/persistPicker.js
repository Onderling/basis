/**
 * persistPicker — pick the right cache-persistence adapter for the
 * runtime so the tasks-v0 browser factory doesn't hard-import the
 * node-only `FilePersist` (which would break the browser bundle).
 *
 * Mirrors `apps/pinboard/src/lib/persistPicker.js` exactly.  Same caller-
 * facing contract:
 *
 *   - `FilePersist`           Node:    `{path: '/data/tasks.json'}`
 *   - `IndexedDBPersist`      Browser: `{dbName: 'tasks-cache'}`
 *   - `AsyncStoragePersist`   RN:      `{dbName, asyncStorage}`
 *
 * Substrate-extraction candidate — the three adapters + this picker
 * are now duplicated across pinboard and tasks-v0.  Rule-of-two satisfied;
 * a later slice should lift them into `@onderling/local-store`.
 */

/**
 * @param {object}  args
 * @param {string}  [args.path]                  → FilePersist (Node)
 * @param {string}  [args.dbName]                → IndexedDBPersist OR AsyncStoragePersist
 * @param {object}  [args.asyncStorage]          → triggers AsyncStoragePersist (requires dbName)
 * @param {string}  [args.storeName]             IndexedDB-only
 * @param {string}  [args.prefix]                AsyncStorage-only (default 'tasks-cache:')
 * @param {number}  [args.saveDelayMs]
 * @returns {Promise<{ persist: object, kind: 'file' | 'idb' | 'async' } | null>}
 */
export async function pickPersist(args = {}) {
  const hasFile  = typeof args.path === 'string' && args.path;
  const hasDb    = typeof args.dbName === 'string' && args.dbName;
  const hasAsync = !!args.asyncStorage;

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
