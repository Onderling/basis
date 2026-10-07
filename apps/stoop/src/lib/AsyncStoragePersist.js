/**
 * AsyncStoragePersist — React Native @react-native-async-storage/
 * async-storage adapter for `CachingDataSource`'s local cache.
 * Same surface as `./FilePersist.js` + `./IndexedDBPersist.js`,
 * different backing store.
 *
 * Why
 *   On Hermes there is no `node:fs` (FilePersist breaks) and no
 *   `globalThis.indexedDB` (IndexedDBPersist throws on construct).
 *   basis-mobile's wave wired VaultAsyncStorage for the
 *   secure-agent's identity / mute-list / audit-log; this adapter
 *   completes the Hermes story by giving stoop's local cache a
 *   place to live.  Without this, stoop's web-style boot on RN
 *   loses state on every app reload.
 *
 *   Interchangeable with the other two from `Agent.js`'s POV: same
 *   `load() / save() / scheduleSave() / flush() / cancel()` methods,
 *   same single-JSON-blob persistence pattern.
 *
 * Storage shape
 *   Key:   `${prefix}${dbName}::state`   (default prefix 'stoop-cache:')
 *   Value: JSON-stringified Map snapshot.
 *
 *   The {dbName, prefix} keeps multiple stoop caches isolated when
 *   the same AsyncStorage instance hosts more than one agent (e.g.
 *   basis-mobile + stoop-mobile share AsyncStorage on the same
 *   device but want separate caches).
 *
 * Test injection: `opts.asyncStorage` accepts any mock that exposes
 * `getItem / setItem / removeItem` — same surface VaultAsyncStorage
 * uses.  No real RN runtime needed for unit tests.
 *
 * Task (2026-05-24). See
 * Project Files/basis/mobile-roadmap-2026-05-24.md.
 */

import { trackPendingSave } from '@onderling/local-store';

const DEFAULT_PREFIX = 'stoop-cache:';
const KEY_SUFFIX     = '::state';

export class AsyncStoragePersist {
  #key;
  #saveDelayMs;
  #storage;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #pendingTimer = null;
  #untrack = null;
  /** Most recent saved snapshot (for diffing / no-op skip). */
  #lastSerialised = null;

  /**
   * @param {object} args
   * @param {string}  args.dbName               cache database name (per-agent)
   * @param {string}  [args.prefix='stoop-cache:']  AsyncStorage key prefix
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
      // AsyncStorage polyfill — same pattern KeychainVault +
      // VaultAsyncStorage use.
      // eslint-disable-next-line global-require
      this.#storage = require('@react-native-async-storage/async-storage').default;
    }
    if (!this.#storage || typeof this.#storage.getItem !== 'function') {
      throw new Error('AsyncStoragePersist: requires an AsyncStorage with getItem/setItem/removeItem (got @react-native-async-storage/async-storage or an injected mock)');
    }
    this.#key         = `${prefix}${dbName}${KEY_SUFFIX}`;
    this.#saveDelayMs = saveDelayMs;
  }

  // ── Public surface (mirrors FilePersist + IndexedDBPersist) ──────

  /**
   * Read the persisted snapshot (if any) and return the resulting Map.
   * Empty / missing → empty Map.  Corrupt JSON → empty Map (non-fatal,
   * matches the other two adapters).
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
   * Write a Map to AsyncStorage.  Single-key replace.
   *
   * @param {Map<string, any>} map
   */
  async save(map) {
    const obj        = Object.fromEntries(map);
    const serialised = JSON.stringify(obj);
    if (serialised === this.#lastSerialised) return;    // no-op skip
    await this.#storage.setItem(this.#key, serialised);
    this.#lastSerialised = serialised;
  }

  /**
   * Schedule a debounced save.  Coalesces bursts of writes into one
   * write per debounce window.
   *
   * @param {Map<string, any>} map
   */
  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#untrack?.();
    const run = () => this.save(map).catch(() => { /* swallow — caller's onError is upstream */ });
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

  /**
   * No-op close — AsyncStorage holds no connection state.  Kept for
   * surface-parity with IndexedDBPersist.close().
   */
  close() { /* no-op */ }
}
