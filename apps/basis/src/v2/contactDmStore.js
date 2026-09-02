/**
 * The contact-DM store — the durable home of 1:1 threads (the G18 fix's storage half), shared
 * web ≡ mobile so the two shells cannot drift on where a DM turn (or a received peer-wire file)
 * lives. Web backs it with IndexedDB, mobile with AsyncStorage; both hand in only a DataSource.
 *
 * A DM thread is scope 'dm' — a 1:1 conversation, not a circle — so this is NOT a second circle
 * store (the one-store-per-circle rule names this module as the allowed constructor for exactly
 * that reason). The wrapper narrows the store to the `{ addItems, listOpen }` surface
 * `createAddressedDeliver` persists through.
 */
import { createCircleStores, memoryDataSource } from '@onderling/item-store';

/**
 * @param {object} a
 * @param {object|null} [a.dataSource]  persistence seam; null → in-memory (ephemeral across boots)
 * @param {string} [a.localActor]       who `addItems` records as the actor when the caller names none
 * @returns {{ addItems: Function, listOpen: Function }}
 */
export function createContactDmStore({ dataSource = null, localActor = 'me' } = {}) {
  const store = createCircleStores({ dataSource: dataSource ?? memoryDataSource() }).getStore('dm');
  return {
    addItems: async (drafts, ctx = {}) => {
      const out = [];
      for (const d of drafts) {
        out.push(await store.put({ type: d.type, text: d.text, source: d.source }, { by: ctx.actor ?? localActor }));
      }
      return out;
    },
    listOpen: async () => store.list(),
  };
}
