/**
 * kring-host — concrete `versions` adapters for the circle stores
 * (γ.2 / Phase 9; consolidated onto `@onderling/versioning` per
 * plans/PLAN-pod-versioning-history-recovery.md "Rewire circle").
 *
 * Each circle store accepts an optional `versions = { capture, list, restore }`
 * adapter that snapshots every save into per-circle history.  This module
 * composes the shared `createVersionStore` substrate (`@onderling/versioning`)
 * with a concrete StorageBackend (localStorage on web via
 * `localStorageBackend` below; AsyncStorage on mobile via the pseudo-pod
 * `createAsBackend` — see `apps/basis-mobile/src/core/
 * objectVersionsStorageRN.js`).  The former substrate,
 * `@onderling/sync-engine`'s `objectVersions.js`, is retired — one version
 * store now serves Folio-files, circle-objects, and pod-resources alike.
 *
 * Storage layout (v2 — one record per version, versionStore's native shape):
 *
 *   `cc.versions2.<storeName>/<encodeURIComponent(circleId)>/<ts>`
 *     → { ts, sha256, size, content } where `content` is the JSON string
 *       of the captured value.
 *
 * Legacy `cc.versions.<storeName>.<circleId>` slot-array keys (the retired
 * objectVersions layout) are left untouched and IGNORED — no active users,
 * so no migration (consolidation decision, 2026-07-09).
 *
 * Semantics preserved from the retired substrate:
 *   - `fingerprintHex` (FNV-1a over `JSON.stringify(value)`) is the content
 *     identity — moved here, since circle was its only consumer.
 *   - Capturing a value identical to the NEWEST entry is a no-op with NO
 *     time window.  versionStore expresses dedup as a debounce, so we pass
 *     `debounceMs: Number.MAX_SAFE_INTEGER` ("always inside the window").
 *     NOT `Infinity`: versionStore guards `Number.isFinite(debounceMs)` and
 *     would silently fall back to its 5-second default.
 *   - Per-circle retention cap 50 (versionStore's own default), overridable
 *     via `retention.perKey` (legacy name; `perSeries` also accepted).
 *   - `list(circleId)` returns newest-first `{ts, sha256, value}` entries
 *     with the value INLINE (substrate `content` → legacy `value`).
 * Improvement over the retired substrate (the consolidation win):
 *   - `restore(circleId, ts)` returns the snapshot's value.  v1 semantics:
 *     restore does NOT write the live circle blob — the adapter has no
 *     handle on the store's own `{load, save}` tier.  The circle stores'
 *     `restoreVersion(...)` persists the returned value through their
 *     normal capture+save path, so a restore lands in live storage AND
 *     appears in history (undoable).
 */

import { createVersionStore } from '@onderling/versioning';

/**
 * Pure-JS FNV-1a 32-bit hash → hex.  Content fingerprint for dedup ONLY
 * (not cryptographic).  Inlined to stay browser/RN-friendly — no
 * `node:crypto`, no async subtle-crypto requirement.  Collision risk is
 * fine for per-circle dedup of consecutive saves.
 * (Moved here from `@onderling/sync-engine/objectVersions` on its retirement.)
 */
export function fingerprintHex(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Key prefix for one store's version series (exported for tests/tooling). */
export const versionsRootFor = (storeName) => `cc.versions2.${storeName}/`;

/**
 * Build a `{capture, list, restore}` versions adapter over a real
 * StorageBackend (`{get, put, delete, list(prefix)}`).  This is the shared
 * factory; `localStorageObjectVersions` (web) and the RN mirror wire a
 * concrete backend into it.
 *
 * @param {object} args
 * @param {string} args.storeName  segment in the versions root (e.g. 'policy')
 * @param {{get:Function, put:Function, delete:Function, list:Function}} args.backend
 * @param {{perKey?:number, perSeries?:number}} [args.retention]
 * @param {()=>number} [args.now]  clock seam (tests)
 * @returns {{ capture: Function, list: Function, restore: Function }}
 */
export function createObjectVersionsAdapter({ storeName, backend, retention, now } = {}) {
  if (typeof storeName !== 'string' || !storeName) {
    throw new TypeError('createObjectVersionsAdapter: storeName required');
  }
  if (!backend
    || typeof backend.get !== 'function' || typeof backend.put !== 'function'
    || typeof backend.delete !== 'function' || typeof backend.list !== 'function') {
    throw new TypeError('createObjectVersionsAdapter: backend must implement {get, put, delete, list}');
  }
  const cap = retention?.perKey ?? retention?.perSeries;
  const store = createVersionStore({
    backend,
    now,
    // Same fingerprint the retired objectVersions substrate used, over the
    // same string (`JSON.stringify(value)` — capture serialises below).
    hash: async (content) => fingerprintHex(String(content)),
    versionsRoot: versionsRootFor(storeName),
    retention: {
      ...(Number.isFinite(cap) && cap > 0 ? { perSeries: Math.floor(cap) } : {}),
      // "identical-sha vs newest always dedups, no time window" — see the
      // module docblock for why this is MAX_SAFE_INTEGER and not Infinity.
      debounceMs: Number.MAX_SAFE_INTEGER,
    },
  });

  const okId = (circleId) => typeof circleId === 'string' && circleId.length > 0;

  return {
    /** Snapshot `value` into the history series for `circleId`. Best-effort. */
    capture: async (circleId, value) => {
      if (!okId(circleId)) return;
      try {
        // JSON round-trip discipline: the stored snapshot is the serialised
        // form, so it can never hold a reference the caller mutates later.
        const serialised = JSON.stringify(value);
        await store.capture(circleId, serialised === undefined ? 'null' : serialised);
      } catch { /* capture is best-effort */ }
    },
    /** Newest-first `{ts, sha256, value}` history for `circleId`; `[]` when none. */
    list: async (circleId) => {
      if (!okId(circleId)) return [];
      try {
        const entries = await store.list(circleId, { withContent: true });
        const out = [];
        for (const e of entries) {
          if (typeof e.content !== 'string') continue;   // missing/corrupt record
          let value;
          try { value = JSON.parse(e.content); } catch { continue; }
          out.push({ ts: e.ts, sha256: e.sha256, value });
        }
        return out;
      } catch {
        return [];
      }
    },
    /**
     * Return the value snapshotted at `ts` (a `ts` from `list(...)`), or
     * `null` when absent.  Does NOT touch the live circle blob — callers
     * (the circle stores' `restoreVersion`) persist the returned value
     * through their own save path.
     */
    restore: async (circleId, ts) => {
      if (!okId(circleId)) return null;
      try {
        const content = await store.read(circleId, ts);
        return typeof content === 'string' ? JSON.parse(content) : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * localStorage-backed StorageBackend (web).  One localStorage key per
 * version record, JSON-encoded in the `{bytes}` envelope versionStore
 * expects.  Enumeration uses the DOM Storage `length`/`key(i)` API, so a
 * test double must be Storage-shaped (see the tests' `mockLocalStorage`).
 * Tolerates an absent storage (SSR / disabled): reads answer empty,
 * writes no-op.
 */
export function localStorageBackend(storage = globalThis.localStorage) {
  const allKeys = () => {
    if (!storage || typeof storage.key !== 'function' || typeof storage.length !== 'number') return [];
    const out = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k === 'string') out.push(k);
    }
    return out;
  };
  return {
    get: async (key) => {
      try {
        const s = storage?.getItem(key);
        if (s == null) return null;
        return { bytes: JSON.parse(s) };
      } catch {
        return null;   // corrupt record reads as absent
      }
    },
    put: async (key, bytes) => {
      try { storage?.setItem(key, JSON.stringify(bytes)); } catch { /* quota / disabled */ }
    },
    delete: async (key) => {
      try { storage?.removeItem(key); } catch { /* ignore */ }
    },
    list: async (prefix) => {
      try { return allKeys().filter((k) => k.startsWith(prefix)).sort(); } catch { return []; }
    },
  };
}

/**
 * Convenience composite — build a localStorage-backed versions adapter for
 * a single named store.  Web's `circleApp.js` calls this once per circle
 * store (policy / recipe / rules).  Signature unchanged across the
 * @onderling/versioning consolidation.
 */
export function localStorageObjectVersions(storeName, storage = globalThis.localStorage, retention) {
  return createObjectVersionsAdapter({
    storeName,
    backend: localStorageBackend(storage),
    retention,
  });
}
