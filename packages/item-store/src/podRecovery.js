/**
 * podRecovery — recover a circle's pod content by merging the LOCAL CACHES of a user's devices
 * (Objective S). Pure, no pod I/O.
 *
 * THE IDEA. Each of a user's devices keeps a LOCAL CACHE of a circle's pod content — concretely the set of
 * that circle's items held in the device's `CircleItemStore` (its DataSource: IDB on web, AsyncStorage/FS on
 * RN, memory in tests). If the pod is lost or corrupted, the content can be RECOVERED by merging those device
 * caches back into one consistent state. Because every device has been ingesting the same circle over the
 * causal-LWW inbound path, no single device is authoritative — the recovered state is the causal max over the
 * union of all caches.
 *
 * WHAT A "CACHE" IS HERE. One device's view of ONE circle's items, supplied as either:
 *   • an ARRAY of item objects (a snapshot already read out of the device), or
 *   • a STORE-LIKE with an async `list()` → the items (a `CircleItemStore` reads its DataSource for you).
 * A device that lacks an item simply doesn't contribute it — partial/missing caches are fine, and recovery
 * from a SUBSET of devices still yields the best-known state for the items that subset holds.
 *
 * THE MERGE — REUSE `causalWinner`, DON'T REINVENT. Union items across caches by `id`; on collision keep the
 * causal winner via `causalWinner(local, incoming)` from `causalMerge.js` (Lamport `clock` + writer-id
 * causal LWW). Consequences we get for free from that comparator:
 *   • a causally-OLDER copy never clobbers a newer one;
 *   • two truly-concurrent copies (equal `clock`) resolve by the DETERMINISTIC writer-id tiebreak;
 *   • therefore the result is the SAME regardless of which caches are present or in what order they're read
 *     (fold of a total order over comparable clocks — order-independent).
 * Same caveat as `causalMerge`: a copy with no `clock` can't be causally ordered, so it falls back to
 * last-seen-wins for that id (order-dependent only among clockless copies) — items written by
 * `CircleItemStore` always carry a `clock`, so this is the edge, not the norm.
 *
 * PURITY + THE WRITE-BACK SEAM. `recoverCircleFromCaches` is PURE: it only reads caches and returns the merged
 * winners + stats; it performs NO pod I/O. Writing the recovered state to a FRESH pod is a separate, injected
 * seam — `writeRecoveredInto(targetStore, items)` — a thin loop of `targetStore.put(item, { origin: true })`
 * so the causal metadata (`clock`/`updatedBy`) is PRESERVED on write-back and the store's own causal guard
 * still applies. Kept out of the pure core so recovery composition and its target are independent.
 */
import { causalWinner } from './causalMerge.js';

/**
 * Read the items out of one device cache.
 * @param {Array<object> | { list: () => (Array<object> | Promise<Array<object>>) } | null | undefined} cache
 * @returns {Promise<Array<object>>}  the cache's items ([] for a null/empty/unreadable cache)
 */
async function readCache(cache) {
  if (!cache) return [];
  if (Array.isArray(cache)) return cache;
  if (typeof cache.list === 'function') {
    const items = await cache.list();
    return Array.isArray(items) ? items : [];
  }
  return [];
}

/**
 * Recover one circle's state by merging N device caches into a single causally-consistent set of items.
 *
 * @param {Array<Array<object> | { list: () => (Array<object>|Promise<Array<object>>) }>} caches  the user's
 *        device caches (each an item array or a store-like with async `list()`); null/missing entries are
 *        skipped, so a partial set of devices still recovers the best-known state.
 * @returns {Promise<{ items: object[], stats: {
 *   caches: number,           // caches actually read (non-null)
 *   scanned: number,          // total item copies seen across all caches
 *   recovered: number,        // distinct items in the merged result (=== items.length)
 *   conflicts: number,        // id collisions — copies of an id beyond its first sighting
 *   replacements: number,     // times an incoming copy BEAT the current best (causal winner flipped)
 *   malformed: number,        // copies skipped for lacking a string id
 * } }>}
 *   `items` = the merged causal winners; `stats` = recovery bookkeeping.
 */
export async function recoverCircleFromCaches(caches) {
  const list = Array.isArray(caches) ? caches : [];
  /** @type {Map<string, object>} id → current best-known copy */
  const best = new Map();
  const stats = { caches: 0, scanned: 0, recovered: 0, conflicts: 0, replacements: 0, malformed: 0 };

  for (const cache of list) {
    if (cache == null) continue;
    stats.caches += 1;
    const items = await readCache(cache);
    for (const incoming of items) {
      if (!incoming || typeof incoming !== 'object') { stats.malformed += 1; continue; }
      const id = incoming.id;
      if (typeof id !== 'string' || !id) { stats.malformed += 1; continue; }
      stats.scanned += 1;
      const current = best.get(id);
      if (current === undefined) {
        best.set(id, incoming);          // first sighting of this id
        continue;
      }
      stats.conflicts += 1;              // a second-or-later copy of an id we've already seen
      // REUSE the causal LWW comparator: keep whichever side is causally newer (deterministic tiebreak on
      // concurrency). `current` plays the role of the stored "local"; `incoming` the arriving copy.
      if (causalWinner(current, incoming) === 'incoming') {
        best.set(id, incoming);
        stats.replacements += 1;
      }
    }
  }

  const items = [...best.values()];
  stats.recovered = items.length;
  return { items, stats };
}

/**
 * WRITE-BACK SEAM (injected, optional) — write recovered winners into a fresh target store.
 *
 * A thin, dependency-free loop over an injected `CircleItemStore`-like target (anything with an async
 * `put(item, opts)`), writing each winner with `origin: true` so the recovered `updatedAt`/`updatedBy` are
 * PRESERVED (not re-stamped to the write time) and the target's own causal guard still governs any pre-existing
 * copy. Separate from `recoverCircleFromCaches` so the pure merge stays free of pod/store I/O.
 *
 * @param {{ put: (item: object, opts?: object) => Promise<object> }} target  a fresh circle store to seed
 * @param {Array<object>} items  the recovered winners (from `recoverCircleFromCaches`)
 * @returns {Promise<{ written: number }>}
 */
export async function writeRecoveredInto(target, items) {
  if (!target || typeof target.put !== 'function') {
    throw new Error('writeRecoveredInto: a target store with put(item, opts) is required');
  }
  let written = 0;
  for (const item of (Array.isArray(items) ? items : [])) {
    await target.put(item, { origin: true });
    written += 1;
  }
  return { written };
}
