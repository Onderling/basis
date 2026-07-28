/**
 * AsyncStorageTombstones — React Native `TombstoneStore` backed by
 * `@react-native-async-storage/async-storage`.
 *
 * Peer dependency: `@react-native-async-storage/async-storage` is NOT
 * declared by `@onderling/pod-client`.  RN apps install it themselves and
 * pass the imported module in via `{ asyncStorage }`, OR rely on the
 * dynamic import which resolves through the host app's `node_modules`.
 *
 * Storage layout: a single key-prefix namespace where each tombstone is
 * one key — `<prefix><uri>` → JSON `{ at: number }`.  This avoids the
 * need to read the whole index for `has` / `add` / `remove`.
 *
 * Mirrors the prefix pattern used by `AsyncStorageAdapter` in
 * `@onderling/react-native`.
 */
import { TombstoneStore } from '../TombstoneStore.js';

const DEFAULT_PREFIX = 'onderling:tombstones:';

/**
 * React Native `TombstoneStore` backed by `@react-native-async-storage/async-storage`.
 * Each tombstone is stored as its own key — `<prefix><uri>` → JSON `{ at }` — so `add`/`has`/`remove`
 * never read a whole index. The AsyncStorage module can be passed in via `{ asyncStorage }` or is
 * dynamic-imported from the host app's `node_modules` on first use.
 */
export class AsyncStorageTombstones extends TombstoneStore {
  #prefix;
  #storage;
  #loadPromise = null;

  /**
   * @param {object} [opts]
   * @param {string} [opts.prefix='onderling:tombstones:']
   * @param {object} [opts.asyncStorage]   — pre-imported AsyncStorage module
   *   (the default export of `@react-native-async-storage/async-storage`).
   *   If omitted, this adapter dynamic-imports the package on first use.
   */
  constructor({ prefix = DEFAULT_PREFIX, asyncStorage } = {}) {
    super();
    this.#prefix  = prefix;
    this.#storage = asyncStorage ?? null;
  }

  async #ensure() {
    if (this.#storage) return this.#storage;
    if (!this.#loadPromise) {
      this.#loadPromise = import('@react-native-async-storage/async-storage')
        .then((m) => { this.#storage = m.default ?? m; return this.#storage; });
    }
    return this.#loadPromise;
  }

  #key(uri) { return `${this.#prefix}${uri}`; }

  async add(uri, { at } = {}) {
    const s = await this.#ensure();
    await s.setItem(this.#key(uri), JSON.stringify({ at: at ?? Date.now() }));
  }

  async has(uri) {
    const s = await this.#ensure();
    const v = await s.getItem(this.#key(uri));
    return v != null;
  }

  async remove(uri) {
    const s = await this.#ensure();
    await s.removeItem(this.#key(uri));
  }

  async list() {
    const s    = await this.#ensure();
    const keys = await s.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(this.#prefix));
    const out  = [];
    for (const k of ours) {
      const raw = await s.getItem(k);
      let at = 0;
      try { at = JSON.parse(raw)?.at ?? 0; } catch { /* swallow */ }
      out.push({ uri: k.slice(this.#prefix.length), at });
    }
    return out;
  }

  async close() {
    // No-op; AsyncStorage has no per-instance handle to release.
  }
}
