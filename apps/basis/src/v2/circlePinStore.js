/**
 * basis v2 — circle "pin to top" persistence (β.5).
 *
 * Pure portable factory over an injectable `{ load, save }` adapter.
 * Holds a `{ circleId: true }` map of pinned circle ids; the launcher
 * partitions tiles into pinned + unpinned within each kind section so
 * pins float to the top of their section without escaping the β.3
 * grouping.
 *
 * Storage is intentionally NOT keyed per-circle — pinning is a per-user
 * preference across the whole circle list, so the IO matches the
 * "keyless" availability store rather than the per-circle policy store.
 * Web wires localStorage at `cc.circlePinned`; mobile wires AsyncStorage
 * at the same key (see circleStoresRN.js + circleApp.js).
 *
 * The factory accepts `{ load, save }` directly (no `io` wrapper) to
 * mirror `createCirclePolicyStore` — consumers compose the adapter at
 * the call site.
 */
import { sealedKeyValue } from './localStoreSeal.js';

export function createCirclePinStore({ load, save } = {}) {
  return {
    /** Return the current `{ circleId: true }` map; `{}` if storage is empty. */
    async get() {
      let raw = null;
      try { raw = typeof load === 'function' ? await load() : null; }
      catch { raw = null; }
      return normalizePinnedMap(raw);
    },

    /**
     * Toggle the pin state for `id`.  Returns the new normalised map so
     * callers can re-render without a follow-up `get()`.
     */
    async toggle(id) {
      if (typeof id !== 'string' || !id) {
        // Defensive: ignore malformed ids; never write garbage to storage.
        return await this.get();
      }
      // a read that FAILED is not "no pins": write nothing, so a one-pin map never lands over the person's pins
      let raw;
      try { raw = typeof load === 'function' ? await load() : null; } catch { return await this.get(); }
      const next = { ...normalizePinnedMap(raw) };
      if (next[id]) delete next[id];
      else next[id] = true;
      if (typeof save === 'function') await save(next);
      return next;
    },

    /** Convenience query — true when `id` is pinned. */
    async isPinned(id) {
      const map = await this.get();
      return Boolean(map[id]);
    },
  };
}

/** localStorage-backed IO (web).  Single key: `cc.circlePinned`. */
export function localStoragePinIo(storage = globalThis.localStorage) {
  const KEY = 'cc.circlePinned';
  // SEALED at rest (ledger L1083: which circles the person pinned), on web and phone alike. A read before the content
  // key WAITS for it: pins not known yet are not "no pins", and a toggle before it never writes a fresh map over them.
  const kv = sealedKeyValue(storage, { name: 'the circle pins', strict: true, waitForKey: true });
  return {
    // a storage error comes through (the store tells "could not read" from "nothing pinned"); not JSON / not openable
    // with this key reads as nothing
    load: async () => {
      const s = await kv.getItem(KEY);
      try { return s ? JSON.parse(s) : null; } catch { return null; }
    },
    save: async (value) => {
      try { await kv.setItem(KEY, JSON.stringify(value)); }
      catch { /* quota / disabled / no content key yet */ }
    },
  };
}

/** Coerce any stored value into a flat `{ id: true }` map (drops non-truthy / non-string keys). */
function normalizePinnedMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k && v) out[k] = true;
  }
  return out;
}
