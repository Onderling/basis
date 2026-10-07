/**
 * changeFeed — ONE place where a host hears that an item it holds changed, whoever changed it: its own write (the
 * circle store's publish) and a snapshot that LANDED from another member (the task rail's `onItemApplied`). Each
 * change goes to every consumer as `{ circleId, before, after }` with its origin — the planned-work runner's event rows,
 * a bot's screen nudge, and whatever else needs "something changed" (one seam, not one detector per feature).
 *
 * `before` is the item as this host last saw it: a projection over the stores it holds, rebuilt at `seed` and kept
 * per change — never a second truth. A circle not yet seeded is seeded from its store at its first change, which then
 * compares the item with itself and fires nothing: a change missed in that moment is better than every item of a
 * circle announced as new after a restart.
 *
 * A write a planned row made carries its origin (`origin: { intention: <row> }`, stamped by the store while the row
 * runs) and is not handed on — on the host that made it and on every host it lands on — so a row whose op writes never
 * fires a row again (the loop rule across hosts).
 */

/**
 * @param {object} a
 * @param {(circleId: string) => {get: Function, list: Function}|null|Promise<object|null>} a.storeFor
 * @param {Array<(change: {circleId: string, before: object|null, after: object|null}, opts: {origin: 'own'|'landed'}) => any>} a.consumers
 *   (read at every change, so a consumer added after the feed is made is heard from then on; a removal has no after)
 */
export function createChangeFeed({ storeFor, consumers = [] }) {
  const seen = new Map();
  const seeded = new Set();
  const key = (circleId, id) => `${circleId}\u0000${id}`;
  const copy = (item) => (item == null ? null : JSON.parse(JSON.stringify(item)));

  async function seed(circleId) {
    if (seeded.has(circleId)) return;
    seeded.add(circleId);
    let rows = [];
    try { rows = (await (await storeFor(circleId))?.list?.()) ?? []; } catch { rows = []; }
    for (const row of rows) if (row?.id && !seen.has(key(circleId, row.id))) seen.set(key(circleId, row.id), copy(row));
  }

  async function tellAll(change, origin) {
    for (const consume of consumers) {
      try { await consume(change, { origin }); } catch { /* one consumer never stops another */ }
    }
  }

  async function changed(circleId, item, origin) {
    if (!circleId || !item?.id) return;
    await seed(circleId);
    let after = item;
    try { after = (await (await storeFor(circleId))?.get?.(item.id)) ?? item; } catch { /* the item as written */ }
    const k = key(circleId, item.id);
    const before = seen.get(k) ?? null;
    seen.set(k, copy(after));
    // a write a planned row made (on this host or another) is nobody's change to react to: no row fires on it again
    if (after?.origin?.intention) return;
    await tellAll({ circleId, before, after }, origin);
  }

  return {
    /** Read what the host holds of these circles now (boot): the baseline the first changes compare with. */
    async seedAll(circleIds) { for (const id of circleIds ?? []) await seed(id); },
    /** The host wrote it. */
    own: (circleId, item) => changed(circleId, item, 'own'),
    /** Another member's write landed here. */
    landed: (circleId, item) => changed(circleId, item, 'landed'),
    /** It was removed (by this host): the consumers hear it with no after; forgotten, so a later item under the id is new. */
    async removed(circleId, id) {
      if (!circleId || !id) return;
      const k = key(circleId, id);
      const before = seen.get(k) ?? null;
      seen.delete(k);
      await tellAll({ circleId, before, after: null }, 'own');
    },
  };
}
