/**
 * AsyncStoragePersist — React Native @react-native-async-storage/
 * async-storage adapter for tasks-v0's `CachingDataSource` local cache.
 *
 * Identical surface + semantics to
 * `apps/pinboard/src/lib/AsyncStoragePersist.js`.  Copied (not imported)
 * to avoid an app→app dependency; substrate-extraction candidate —
 * lift these three adapters + persistPicker into `@onderling/local-store`
 * once a third app needs them.
 *
 * Default prefix is `'tasks-cache:'` so a single AsyncStorage instance
 * hosting both pinboard ('pinboard-cache:') and tasks-v0 caches keeps them
 * isolated.  basis-mobile's agentBundle passes
 * `{dbName:'cc-tasks-cache', asyncStorage}` (no explicit prefix).
 */

const DEFAULT_PREFIX = 'tasks-cache:';
const KEY_SUFFIX     = '::state';

export class AsyncStoragePersist {
  #key;
  #saveDelayMs;
  #storage;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #pendingTimer = null;
  /** Most recent saved snapshot (for diffing / no-op skip). */
  #lastSerialised = null;

  /**
   * @param {object} args
   * @param {string}  args.dbName               cache database name (per-agent)
   * @param {string}  [args.prefix='tasks-cache:']  AsyncStorage key prefix
   * @param {number}  [args.saveDelayMs=200]    debounce window (ms)
   * @param {object}  [args.asyncStorage]       injectable mock; defaults to
   *                                            @react-native-async-storage/async-storage
   */
  constructor({ dbName, prefix = DEFAULT_PREFIX, saveDelayMs = 200, asyncStorage } = {}) {
    if (typeof dbName !== 'string' || !dbName) {
      throw new TypeError('AsyncStoragePersist: dbName required');
    }
    if (asyncStorage) {
      this.#storage = asyncStorage;
    } else {
      // Lazy require so vitest can import this module without an
      // AsyncStorage polyfill — same pattern pinboard's adapter uses.
      // eslint-disable-next-line global-require
      this.#storage = require('@react-native-async-storage/async-storage').default;
    }
    if (!this.#storage || typeof this.#storage.getItem !== 'function') {
      throw new Error('AsyncStoragePersist: requires an AsyncStorage with getItem/setItem/removeItem');
    }
    this.#key         = `${prefix}${dbName}${KEY_SUFFIX}`;
    this.#saveDelayMs = saveDelayMs;
  }

  // ── Public surface (mirrors FilePersist + IndexedDBPersist) ──────

  /**
   * Read the persisted snapshot (if any) and return the resulting Map.
   * Empty / missing → empty Map.  Corrupt JSON → empty Map (non-fatal).
   *
   * @returns {Promise<Map<string, any>>}
   */
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

  /**
   * Write a Map to AsyncStorage (single-key replace).
   *
   * @param {Map<string, any>} map
   */
  async save(map) {
    const obj        = Object.fromEntries(map);
    const serialised = JSON.stringify(obj);
    if (serialised === this.#lastSerialised) return;     // no-op skip
    await this.#storage.setItem(this.#key, serialised);
    this.#lastSerialised = serialised;
  }

  /**
   * Schedule a debounced save.  Coalesces bursts into one write.
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

  /** No-op close — AsyncStorage holds no connection state.  Kept for
   *  surface-parity with IndexedDBPersist.close(). */
  close() { /* no-op */ }
}
