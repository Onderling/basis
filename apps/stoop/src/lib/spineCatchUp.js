/**
 * spineCatchUp — the receiver half of type-general catch-up for the SPINE channel (task C).
 *
 * The spine resolution policy declares RELIABLE delivery (`resolutionPolicy.js`): a lost membership/eviction
 * event leaves a lingering divergence, so it must reach every device — including one that was OFFLINE when the
 * change happened. Live fan-out covers online members; this covers the offline one: on reconnect the device
 * PULLS the circle's membership-spine statements (via the `getSpineSince` skill) and puts them into its own
 * circle store. It does NOT fold here — `deriveRoster` verifies (`verifySpine`) + folds on the next roster read,
 * so putting the item into the store is the whole ingest.
 *
 * Safe by construction: the put is id-preserving (idempotent — re-pulling a known statement is free), and the
 * roster fold is deny-wins / strengthen-only, so a pulled statement can only DROP a member, and a foreign or
 * partial one is verified against the circle and ignored — never corrupts who-is-in.
 */
import { SPINE_STATEMENT_ITEM } from '@onderling/core';

/**
 * Put pulled membership-spine statements into the receiver's circle store, id-preserving.
 *
 * @param {object} a
 * @param {{ put: (item: object, opts?: object) => any }} a.store  the circle's CircleItemStore
 * @param {Array<{id: string, type: string, source: object}>} a.items  raw spine items from `getSpineSince`
 * @returns {Promise<number>}  how many were put (malformed / wrong-type items are skipped)
 */
export async function ingestSpineItems({ store, items } = {}) {
  if (!store || typeof store.put !== 'function' || !Array.isArray(items)) return 0;
  let put = 0;
  for (const it of items) {
    if (!it || it.type !== SPINE_STATEMENT_ITEM || typeof it.id !== 'string' || !it.id || !it.source) continue;
    try {
      // The SAME id-preserving, non-echoing, causal-merge path the live inbound sync uses
      // (`circleStoreInbound`): sync:false → no re-publish (echo guard); origin:true → keep the causally-newer
      // side (no arrival-order clobber). Idempotent by id, so a re-pull of a known statement is a no-op.
      await store.put({ type: SPINE_STATEMENT_ITEM, id: it.id, source: it.source }, { sync: false, origin: true });
      put += 1;
    } catch { /* best-effort; a re-pull or the live fan reconciles */ }
  }
  return put;
}

export default ingestSpineItems;
