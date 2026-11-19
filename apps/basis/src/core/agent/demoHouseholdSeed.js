/**
 * The household's demo items — and the one-time removal of the copies they left on real devices.
 *
 * The three items below are demo scaffolding: `/list shopping` and the brief demo are non-empty when a demo boot asks
 * for them (`seedDemoData: true`). Until ledger L1069 they were written at EVERY start of every shell that did not
 * pass `seedHousehold: false` (web and phone did not), so a device with a persisted store gained three more at each
 * start. A real start writes none of them now, and `sweepDemoSeedOnce` takes away what piled up: only items whose
 * author is exactly the demo author AND whose text is one of the three — an item a person wrote is never touched,
 * whatever its text.
 */

/** Deterministic, oldest-first (the store preserves insertion order). */
export const SEED_HOUSEHOLD_ITEMS = Object.freeze([
  Object.freeze({ type: 'shopping', text: 'Milk' }),
  Object.freeze({ type: 'errand', text: 'Post a parcel' }),
  Object.freeze({ type: 'task', text: 'Vacuum living room' }),
]);

/** The author the demo items were written as (`createdBy`). */
export const DEMO_SEED_AUTHOR = 'webid:local-demo-user';

/** The kept mark, on the device's plain marker vault (beside `restore-pending` and `forget-pending`). */
export const DEMO_SEED_SWEPT_KEY = 'demo-seed-swept';

const SEED_TEXTS = new Set(SEED_HOUSEHOLD_ITEMS.map((s) => s.text));

/** Is this a copy of a demo item (demo author, demo text)? */
export function isDemoSeedItem(item) {
  return !!item && item.createdBy === DEMO_SEED_AUTHOR && SEED_TEXTS.has(item.text);
}

/** Write the demo items into `store` (a demo boot only). */
export async function seedDemoHousehold(store, addItem) {
  for (const seed of SEED_HOUSEHOLD_ITEMS) {
    try { await addItem(store, { type: seed.type, text: seed.text }, { by: DEMO_SEED_AUTHOR }); }
    catch (err) { console.warn('[realAgent] seed household item failed:', err?.message ?? err); }
  }
}

/**
 * Remove the demo copies from `store`, at most once per device: the mark on `markerVault` says it has run. A start
 * that finds nothing to remove writes nothing to the store (only the mark, once). The removal does not fan
 * (`sync: false`): the copies were written before the circle's lane emitter existed, so none of them ever left this
 * device. A store backed by a pod medium is written through as any delete is.
 *
 * @returns {Promise<{ ran: boolean, removed: number }>}
 */
export async function sweepDemoSeedOnce({ store, markerVault }) {
  if (!store || !markerVault) return { ran: false, removed: 0 };
  try { if (await markerVault.get(DEMO_SEED_SWEPT_KEY)) return { ran: false, removed: 0 }; }
  catch { return { ran: false, removed: 0 }; }   // an unreadable mark: try again next start, never sweep blind twice
  let removed = 0;
  try {
    const items = (await store.list()) ?? [];
    for (const it of items) {
      if (!isDemoSeedItem(it)) continue;
      try { await store.delete(it.id, { sync: false }); removed += 1; } catch { /* the next pass is gone; the rest stay */ }
    }
  } catch (err) {
    console.warn('[realAgent] the demo items could not be read — removal deferred to the next start:', err?.message ?? err);
    return { ran: false, removed };
  }
  try { await markerVault.set(DEMO_SEED_SWEPT_KEY, JSON.stringify({ at: new Date().toISOString(), removed })); }
  catch { /* the mark is kept next start; a second pass finds only what is still a demo copy */ }
  if (removed) console.info(`[realAgent] removed ${removed} demo household item(s) left by earlier starts`);
  return { ran: true, removed };
}
