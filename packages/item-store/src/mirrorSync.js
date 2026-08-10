/**
 * wireStoreMirror — attach a peer MIRROR to a CircleItemStore (cluster L3 · no-pod-sync-off-household).
 *
 * The store-agnostic version of what the household `InMemoryStore.setSyncHook` did: on every write the store
 * hands the item to `mirror.publishItem` (fan-out to the peer roster), on every delete the id to
 * `mirror.publishItemRemoved`. `mirror` is any `{ publishItem, publishItemRemoved }` — e.g. a
 * `@onderling/notify-envelope` substrate mirror over the secure-mesh transport. This lets the no-pod cross-device
 * sync ride the per-circle `CircleItemStore` WITHOUT the household agent owning the store (the decoupling that
 * unblocks retiring the legacy household agent). Inbound (peer → store) is the mirror's own ingest, adapted to
 * `store.put` — a separate seam (the next step).
 *
 * @param {{setSyncHook:Function}} store   a CircleItemStore
 * @param {{publishItem?:Function, publishItemRemoved?:Function}} mirror
 * @returns {() => void} detach
 */
export function wireStoreMirror(store, mirror) {
  if (!store || typeof store.setSyncHook !== 'function' || !mirror || typeof mirror !== 'object') return () => {};
  store.setSyncHook({
    publishItem:        (item) => (typeof mirror.publishItem === 'function' ? mirror.publishItem(item) : undefined),
    // The store hands the removed ITEM alongside the id — forwarded so a routing publisher can pick a
    // path per item type (a plain mirror just ignores the extra argument).
    publishItemRemoved: (id, removedItem) => (typeof mirror.publishItemRemoved === 'function' ? mirror.publishItemRemoved(id, removedItem) : undefined),
  });
  return () => store.setSyncHook(null);
}
