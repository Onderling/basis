/**
 * The own store on WEB keeps a person's own appointment across a reload (IndexedDB, as the web shell hands it). Found by
 * the Gepland walk, 2026-10-07: the appointment showed, and after a reload it was gone — nothing had reached IndexedDB.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';
import { lazyOwnStore } from '../src/v2/ownDevicesStore.js';

const tomorrowAt = (h) => { const d = new Date(Date.now() + 86_400_000); d.setHours(h, 0, 0, 0); return d.toISOString(); };

describe('the own store on web', () => {
  it('an appointment of no circle reaches IndexedDB and comes back on the next boot', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: lazyOwnStore({ dbName: 'cc-own-devices-t1', storeName: 'items' }) });
    expect((await a.callSkill('calendar', 'addEvent', { title: 'tandarts', when: tomorrowAt(14) }))?.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 800));   // past the adapter's save delay
    const fresh = await lazyOwnStore({ dbName: 'cc-own-devices-t1', storeName: 'items' })();
    expect((await fresh.listByType('calendar-event')).map((e) => e.title)).toEqual(['tandarts']);
  });
});
