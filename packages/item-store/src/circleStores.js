/**
 * createCircleStores — a per-circle registry of `CircleItemStore`s (cluster L · L1 integration).
 *
 * Mirrors the existing household per-circle pattern (realAgent.js: ONE shared DataSource, each circle gets a
 * store namespaced by a `…/circles/<circleId>/` rootContainer). Hands any function a live, type-indexed store
 * for the active circle — the data substrate L2 (containment) / L3 (dissolve) / L4 (capability) build on.
 *
 * web≡mobile by construction: this is one shared source both shells import; only the injected `dataSource`
 * (no-pod memory / persistent CachingDataSource / sealed pod-client-backed) differs per platform/tier.
 *
 * @param {object} args
 * @param {import('@onderling/core').DataSource} args.dataSource  ONE shared backing (read/write/delete/list); each
 *        circle is isolated by its rootContainer namespace, NOT a separate DataSource.
 * @param {{ validate?: (item:object)=>{ok:boolean,errors?:Array} }} [args.registry]  @onderling/item-types registry
 *        (injected; validates on write). Same instance for every circle so third-party `registerType`s apply uniformly.
 * @param {{ hasChannel:(t:string,r:string)=>boolean }} [args.resolution]  the DECLARATION LAYER's
 *        (item-type,field)→resolution-policy registry (`resolutionPolicy`), shared by every circle's store so the
 *        inbound merge dispatch is uniform. Absent → each store falls back to the safe code floor.
 * @param {string} [args.rootPrefix='mem://circles/']  logical root; PodRouting maps it to the physical pod per tier.
 * @param {(circleId:string, store:import('./CircleItemStore.js').CircleItemStore)=>void} [args.onStore]  called ONCE
 *        when a circle's store is first created — the seam to attach a per-circle peer mirror (L3 · no-pod-sync-off-
 *        household: `onStore: (id, s) => wireStoreMirror(s, mirrorFor(id))`). Lazy stores mean there's no other moment.
 * @param {(circleId:string)=>(import('@onderling/core').DataSource|null|undefined)} [args.dataSourceFor]  per-circle
 *        MEDIUM by posture (cache-mode mirroring): a pod-backed circle may run over its OWN DataSource — a cache-mode
 *        PseudoPod that write-throughs to the pod ("pod is truth, local cache is reality") — instead of the shared local
 *        backing. Return a DataSource to override for that circle; return null/undefined (or omit the fn) → the shared
 *        `dataSource`, today's behaviour, fully back-compat.
 * @returns {{ getStore:(circleId:string)=>import('./CircleItemStore.js').CircleItemStore, has:(circleId:string)=>boolean, rootFor:(circleId:string)=>string }}
 */
import { CircleItemStore } from './CircleItemStore.js';

/**
 * Lazy per-circle registry of `CircleItemStore`s over ONE shared `dataSource`: `getStore(circleId)`
 * creates a store namespaced under `<rootPrefix><circleId>/` on first ask (invoking `onStore` once,
 * best-effort) and caches it; `has(circleId)` and `rootFor(circleId)` are plain lookups. The module
 * doc above details each parameter.
 * @returns {{getStore: (circleId: string) => object, has: (circleId: string) => boolean,
 *   rootFor: (circleId: string) => string}}
 */
export function createCircleStores({ dataSource, registry, resolution, rootPrefix = 'mem://circles/', onStore, dataSourceFor } = {}) {
  if (!dataSource || typeof dataSource.read !== 'function') {
    throw new Error('createCircleStores: a shared core.DataSource (read/write/delete/list) is required');
  }
  const stores = new Map();   // circleId → CircleItemStore (created lazily, cached)
  const rootFor = (circleId) => `${rootPrefix}${circleId}/`;

  return {
    /** The live, type-indexed store for a circle — created on first ask, then cached. */
    getStore(circleId) {
      if (typeof circleId !== 'string' || !circleId) {
        throw new Error('createCircleStores.getStore: a non-empty circleId is required');
      }
      let store = stores.get(circleId);
      if (!store) {
        // Per-circle MEDIUM by posture (cache-mode mirroring): a pod-backed circle may run over its OWN
        // DataSource (a cache-mode PseudoPod write-throughing to the pod); absent/null → the shared local
        // backing (today's behaviour). The store row stays THE materialised head either way (G-C1) — only
        // its medium differs, which is the "pod is truth, local cache is reality" posture for a pod circle.
        const backing = (typeof dataSourceFor === 'function' && dataSourceFor(circleId)) || dataSource;
        store = new CircleItemStore({ dataSource: backing, rootContainer: rootFor(circleId), registry, resolution });
        stores.set(circleId, store);
        if (typeof onStore === 'function') { try { onStore(circleId, store); } catch { /* best-effort wiring */ } }
      }
      return store;
    },
    has: (circleId) => stores.has(circleId),
    rootFor,
  };
}
