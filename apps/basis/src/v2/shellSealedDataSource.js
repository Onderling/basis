/**
 * A persistent store a SHELL builds for itself — sealed at rest, and never built before the device's content key.
 *
 * Most stores are built inside the agent, which hands them its content seal. A few a shell builds on its own (the
 * contact-DM store on web and phone, the phone's circle lists): those were built with `buildHouseholdDataSource`
 * and NO strategy, so they wrote their rows as plain text — a person's direct messages readable in IndexedDB or
 * AsyncStorage, while the box sealed its copy. This is the one way a shell builds such a store: it waits for the
 * content key the agent publishes (`onShellContentSeal`), then builds the store with it. Built before the key, a
 * store would stay plain for the whole session, so it does not resolve until the key is there.
 */
import { buildHouseholdDataSource } from '../household/persist.js';
import { onShellContentSeal } from './localStoreSeal.js';

/**
 * @param {object} persistDb  `buildHouseholdDataSource`'s descriptor (`{dbName, storeName}` · `{dbName, asyncStorage}` · `{path}`), with its `kind`
 * @returns {Promise<object|null>} the sealed data source
 */
export async function buildShellSealedDataSource(persistDb) {
  const strategy = await new Promise((resolve) => { onShellContentSeal(resolve); });
  return buildHouseholdDataSource(persistDb, { strategy });
}
