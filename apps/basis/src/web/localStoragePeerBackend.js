/**
 * localStoragePeerBackend — persistent storageBackend for core's `PeerGraph`
 * on the web, so the v2 Contacten roster survives a reload (it was in-memory
 * and vanished on refresh).
 *
 * Implements the PeerGraph storageBackend interface — `get(key)`, `set(key,
 * value)`, `delete(key)`, `list() → string[]` — over `globalThis.localStorage`.
 * PeerGraph stores already-JSON-stringified values and prefixes every key with
 * `peer:` itself, then filters `list()` for that prefix; this backend only adds
 * its own namespace (`prefix`) on top and strips it back off in `list()`.
 *
 * Mirrors the RN `AsyncStorageAdapter` (web ≡ mobile): both wrap a platform
 * key-value store with the same four-method contract. Guards for a missing
 * `localStorage` (SSR / vitest node env) by falling back to an in-memory Map so
 * the app never crashes when persistence is unavailable.
 */

/**
 * @param {object}  [opts]
 * @param {string}  [opts.prefix='cc-peers:']  — localStorage key namespace
 * @param {Storage} [opts.storage]             — override (defaults to globalThis.localStorage)
 * @returns {{ get(k:string):Promise<string|null>, set(k:string,v:string):Promise<void>,
 *             delete(k:string):Promise<void>, list():Promise<string[]> }}
 */
export function createLocalStoragePeerBackend({ prefix = 'cc-peers:', storage } = {}) {
  const store = storage ?? safeLocalStorage();
  const keyFor = (key) => `${prefix}${key}`;

  return {
    // awaited: both shells hand a SEALED storage (ledger L1083), which answers async; the phone's is AsyncStorage
    async get(key) {
      const raw = await store.getItem(keyFor(key));
      return raw == null ? null : raw;
    },
    async set(key, value) {
      await store.setItem(keyFor(key), value);
    },
    async delete(key) {
      await store.removeItem(keyFor(key));
    },
    async list() {
      if (typeof store.getAllKeys === 'function') {   // AsyncStorage lists this way
        return ((await store.getAllKeys()) ?? []).filter((k) => typeof k === 'string' && k.startsWith(prefix)).map((k) => k.slice(prefix.length));
      }
      const out = [];
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out;
    },
  };
}

/**
 * Returns `globalThis.localStorage` when it's usable, otherwise an in-memory
 * Map-backed shim with the same Storage surface this module needs
 * (getItem/setItem/removeItem/key/length). Keeps SSR + tests from crashing.
 */
function safeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  } catch { /* accessing localStorage can throw (e.g. sandboxed / disabled) */ }
  return memoryStorage();
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}
