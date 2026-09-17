/**
 * buildBundle — Tasks V1 local-first storage bundle.
 *
 * Wraps `@onderling/local-store`'s `CachingDataSource` so the agent
 * boots against a Map-cache immediately (Tasks V1's local-only-mode
 * rule) and write-throughs to an inner DataSource when one is
 * attached (pod sign-in flow).
 *
 * The CachingDataSource owns the local cache (a `Map<string, any>`
 * — see `packages/local-store/src/CachingDataSource.js`). For
 * restart-survival, callers either:
 *   - pass a pre-loaded `localStore` + `onLocalChange` callback
 *     (low-level, fully manual — what most existing callers do); or
 *   - pass a `persistDb` descriptor, in which case `buildBundle`
 *     becomes async, picks the right adapter (File / IndexedDB /
 *     AsyncStorage) via `persist/persistPicker.js`, loads any prior
 *     snapshot, and wires `onLocalChange` to debounce-save back.
 *
 * `attachInner(inner)` flips the bundle from local-only to attached;
 * it auto-flushes any pending writes and runs a bulk-sync.
 * `detachInner()` reverses (e.g. on pod sign-out — keep working
 * locally).
 *
 * M4 addition: the bundle now carries a `_podCtx` mutable holder and
 * passes an `innerKeyMap` closure to `CachingDataSource`. While
 * `_podCtx.active` is false (the no-pod default) `toInner`/`fromInner`
 * are pure identity → CachingDataSource stays byte-neutral
 * (pod-independence.md). `attachTasksBundle` fills `_podCtx` at pod
 * sign-in time. The returned bundle object exposes `_podCtx` so callers
 * can inspect routing state.
 *
 * # Return type — sync vs async
 *
 * Without `persistDb`, `buildBundle(...)` returns the bundle
 * SYNCHRONOUSLY (every pre-existing caller relies on this).  With
 * `persistDb`, it returns `Promise<bundle>` — the picker + load are
 * inherently async.  Existing callers that omit `persistDb` see no
 * behaviour change.
 */

import { CachingDataSource, SyncCadence } from '@onderling/local-store';

import { pickPersist } from './persist/persistPicker.js';
import { sealedPersist } from '@onderling/local-store';   // content is sealed on the way to disk, plaintext in the cache

/**
 * Build a Tasks-shaped local-first storage bundle.
 *
 * @param {object} [args]
 * @param {object} [args.inner]
 *   A `core.DataSource` to write through to. Default: none — bundle
 *   is local-only until `attachInner` is called.
 * @param {Map<string, any>} [args.localStore]
 *   Optional pre-loaded local cache. Default: a fresh Map. Apps that
 *   want restart-survival pass a Map loaded from a `FilePersist`-style
 *   adapter and supply `onLocalChange` to keep it on disk.
 * @param {(map: Map<string, any>) => void} [args.onLocalChange]
 *   Optional callback fired after every local-cache mutation. Wire
 *   this to a file-persist adapter for restart-survival.  Ignored
 *   when `persistDb` is set (the picker installs its own callback).
 * @param {object} [args.persistDb]
 *   Optional persistence descriptor passed to `pickPersist`.  Pass
 *   exactly one of:
 *     - `{path}`                       → FilePersist (Node)
 *     - `{dbName, storeName?}`         → IndexedDBPersist (browser)
 *     - `{dbName, asyncStorage}`       → AsyncStoragePersist (RN)
 *   When set, `buildBundle` becomes async (returns Promise<bundle>),
 *   loads any prior snapshot into the cache, and wires
 *   `onLocalChange → persist.scheduleSave` for restart-survival.
 *   Mirrors stoop's `Agent.js` `persistDb` path so web (IDB) and
 *   mobile (AsyncStorage) get the same restart-survival semantics.
 * @param {string[]} [args.localOnlyPrefixes]
 *   Paths matching ANY prefix here never sync to the inner pod.
 *   Tasks V1 default: `['mem://tasks/settings/devices/',
 *   'mem://tasks/settings/.migrated-from-v2']` so per-device settings
 *   + the migration marker stay local.
 * @param {object} [args.cadence]
 *   Optional `SyncCadence` configuration (currently informational —
 *   apps wire the cadence's `start()` / `stop()` themselves).
 *
 * @returns {(
 *   {
 *     cache:        CachingDataSource,
 *     cadence:      SyncCadence | null,
 *     attachInner:  (inner: object) => Promise<void>,
 *     detachInner:  () => Promise<void>,
 *     close:        () => Promise<void>,
 *     _podCtx:      object,
 *     _persist?:    object,    // present only when persistDb was set
 *   }
 *   | Promise<object>
 * )}
 *   Returns synchronously when `persistDb` is omitted (backwards
 *   compat).  Returns a Promise when `persistDb` is set.
 */
export function buildBundle({
  inner,
  localStore,
  onLocalChange,
  persistDb,
  localOnlyPrefixes,
  cadence: cadenceCfg,
} = {}) {
  // The async-persistence path is opt-in.  When `persistDb` is set we
  // load the prior snapshot first, then construct the bundle with
  // localStore + onLocalChange already wired.  No existing caller
  // passes persistDb, so the sync return preserved below stays the
  // hot path.
  if (persistDb && typeof persistDb === 'object') {
    return buildBundleWithPersistImpl({
      inner,
      persistDb,
      localOnlyPrefixes,
      cadenceCfg,
    });
  }

  // M4: mutable pod-context holder. The `innerKeyMap` closure below
  // reads this at every toInner/fromInner call. While `active` is
  // false (the no-pod default) both functions are identity →
  // CachingDataSource is byte-neutral (pod-independence.md).
  // `attachTasksBundle` fills this at pod sign-in time so the
  // decentralised/hybrid routing activates transparently.
  const podCtx = {
    active:    false,
    classify:  null,
    reverse:   null,
    podRouting: null,
    circleId:    null,
    vars:      null,
  };

  const podInnerKeyMap = {
    toInner: (p) => {
      if (!podCtx.active
          || typeof podCtx.classify !== 'function'
          || !podCtx.podRouting) return p;
      const c = podCtx.classify(p, { circleId: podCtx.circleId });
      if (!c) return p; // unroutable → identity (no-pod safe)
      const base = podCtx.podRouting.resolve(c.storageFn, podCtx.vars || {});
      if (typeof base !== 'string' || base.length === 0) return p;
      return base.endsWith('/') ? base + c.tail : `${base}/${c.tail}`;
    },
    // Phase 3.3 inverse — re-key pod URIs to logical `mem://tasks/…`
    // space for pull-back / cross-app reads. Inactive → identity.
    fromInner: (u) => {
      if (!podCtx.active
          || typeof podCtx.reverse !== 'function'
          || !podCtx.podRouting) return u;
      const logical = podCtx.reverse({
        resolve: (fn, v) => podCtx.podRouting.resolve(fn, v),
        circleId:  podCtx.circleId,
        podUri:  u,
        vars:    podCtx.vars || {},
      });
      return logical ?? u;
    },
  };

  return assembleBundle({
    inner,
    localStore,
    onLocalChange,
    localOnlyPrefixes,
    cadenceCfg,
    podCtx,
    podInnerKeyMap,
    persist: null,
  });
}

/**
 * Async path: resolve the persistence adapter, load any prior
 * snapshot, then assemble the bundle with the loaded Map +
 * `onLocalChange` wired to `persist.scheduleSave`.
 *
 * Kept module-private — callers reach it via `buildBundle({persistDb})`.
 */
async function buildBundleWithPersistImpl({
  inner,
  persistDb,
  contentSeal = null,
  localOnlyPrefixes,
  cadenceCfg,
}) {
  const picked = await pickPersist(persistDb);
  // `pickPersist` returns null when no path/dbName is set — defensive
  // fall-through to the in-memory shape (matches stoop's Agent.js).
  let loadedStore;
  let persist = null;
  let onLocalChange;
  if (picked) {
    // Sealed at rest: the adapter writes ciphertext, the cache above it stays plaintext so `query()`
    // still parses and filters. Without a strategy the adapter is returned unchanged.
    persist        = sealedPersist(picked.persist, contentSeal);
    loadedStore    = await persist.load();
    onLocalChange  = (m) => persist.scheduleSave(m);
  }
  // The podCtx / innerKeyMap shape is identical to the sync path.
  const podCtx = {
    active: false, classify: null, reverse: null, podRouting: null,
    circleId: null, vars: null,
  };
  const podInnerKeyMap = {
    toInner: (p) => {
      if (!podCtx.active
          || typeof podCtx.classify !== 'function'
          || !podCtx.podRouting) return p;
      const c = podCtx.classify(p, { circleId: podCtx.circleId });
      if (!c) return p;
      const base = podCtx.podRouting.resolve(c.storageFn, podCtx.vars || {});
      if (typeof base !== 'string' || base.length === 0) return p;
      return base.endsWith('/') ? base + c.tail : `${base}/${c.tail}`;
    },
    fromInner: (u) => {
      if (!podCtx.active
          || typeof podCtx.reverse !== 'function'
          || !podCtx.podRouting) return u;
      const logical = podCtx.reverse({
        resolve: (fn, v) => podCtx.podRouting.resolve(fn, v),
        circleId:  podCtx.circleId,
        podUri:  u,
        vars:    podCtx.vars || {},
      });
      return logical ?? u;
    },
  };
  return assembleBundle({
    inner,
    localStore:        loadedStore,
    onLocalChange,
    localOnlyPrefixes,
    cadenceCfg,
    podCtx,
    podInnerKeyMap,
    persist,
  });
}

/** Build the bundle object once all sync/async prep is done. */
function assembleBundle({
  inner,
  localStore,
  onLocalChange,
  localOnlyPrefixes,
  cadenceCfg,
  podCtx,
  podInnerKeyMap,
  persist,
}) {
  const cache = new CachingDataSource({
    inner:             inner ?? null,
    localStore,
    onLocalChange,
    localOnlyPrefixes: localOnlyPrefixes ?? [
      'mem://tasks/settings/devices/',
      'mem://tasks/settings/.migrated-from-v2',
    ],
    innerKeyMap: podInnerKeyMap,
  });

  const cadence = cadenceCfg ? new SyncCadence(cadenceCfg) : null;

  return {
    cache,
    cadence,
    // M4: expose the mutable podCtx as `_podCtx` so `attachTasksBundle`
    // can fill it at pod sign-in time (same seam as Stoop's Agent.js
    // Phase 2.4-core, and as tasks-mobile's forward-courtesy seam).
    _podCtx: podCtx,
    // Present only when `persistDb` was set; exposed so callers /
    // tests can `flush()` before disposing (mirrors stoop's _persist).
    _persist: persist,
    async attachInner(nextInner) {
      if (!nextInner || typeof nextInner.read !== 'function') {
        throw new TypeError('buildBundle.attachInner: inner DataSource required');
      }
      await cache.attachInner(nextInner);
    },
    async detachInner() {
      await cache.attachInner(null);
    },
    async close() {
      if (cadence?.stop) await cadence.stop();
      // `persist` lifecycle: the debounced save fires on its own (the
      // pendingTimer closes over the live Map reference, so the most
      // recent state lands on disk).  Tests that need strict ordering
      // wait `> saveDelayMs` (default 200ms) before re-opening.  Match
      // stoop's Agent.js — it relies on the same debounce-fires-on-its
      // -own pattern and doesn't force-flush on close.
      try { persist?.close?.(); } catch { /* defensive */ }
    },
  };
}
