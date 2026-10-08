// M3 (2026-05-29) — AsyncStorage-backed circle stores round-trip.
//
// The RN screens persist policy / override / availability through the
// shared store factories wired onto AsyncStorage.  These tests prove the
// IO adapters read back what they wrote AND that the on-disk keys match
// the web convention (so a future pod-sync sees one shape on both
// surfaces).  A Map-backed mock stands in for AsyncStorage.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../basis/src/v2/localStoreSeal.js';
import {
  asyncKeyedIo, asyncFixedIo,
  makeCirclePolicyStoreRN, makeMemberOverrideStoreRN, makeAvailabilityStoreRN,
} from '../src/core/circleStoresRN.js';
import { DEFAULT_CIRCLE_POLICY, DEFAULT_AVAILABILITY } from '@onderling-app/basis';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

describe('M3 circleStoresRN', () => {
  let storage;
  // the app saves a policy only after boot, when the content key exists (the policy is sealed at rest)
  beforeEach(() => { storage = mockAsyncStorage(); setShellContentSeal(groupKeyStrategy({ groupKey: 'A'.repeat(43) })); });
  afterEach(() => setShellContentSeal(null));

  it('policy store round-trips an edit under cc.circlePolicy.<id>', async () => {
    const store = makeCirclePolicyStoreRN(storage);
    const fresh = await store.get('circle-1');
    expect(fresh).toEqual(DEFAULT_CIRCLE_POLICY);

    await store.update('circle-1', { llmTool: 'local', features: { tasks: true } });
    expect([...storage.map.keys()]).toContain('cc.circlePolicy.circle-1');

    const reloaded = await makeCirclePolicyStoreRN(storage).get('circle-1');
    expect(reloaded.llmTool).toBe('local');
    expect(reloaded.features.tasks).toBe(true);
  });

  it('override store round-trips a flow-through patch under cc.circleOverride.<id>', async () => {
    const store = makeMemberOverrideStoreRN(storage);
    await store.update('circle-9', { chatOff: true, flowThrough: { tasksToPersonal: true } });
    expect([...storage.map.keys()]).toContain('cc.circleOverride.circle-9');

    const reloaded = await makeMemberOverrideStoreRN(storage).get('circle-9');
    expect(reloaded.chatOff).toBe(true);
    expect(reloaded.flowThrough.tasksToPersonal).toBe(true);
  });

  it('availability store is keyless and persists under cc.availability', async () => {
    const store = makeAvailabilityStoreRN(storage);
    expect(await store.get()).toEqual(DEFAULT_AVAILABILITY);

    await store.update({ holiday: { active: true, until: '2026-06-10' } });
    expect([...storage.map.keys()]).toEqual(['cc.availability']);

    const reloaded = await makeAvailabilityStoreRN(storage).get();
    expect(reloaded.holiday.active).toBe(true);
    expect(reloaded.holiday.until).toBe('2026-06-10');
  });

  it('asyncKeyedIo / asyncFixedIo tolerate corrupt JSON (return null)', async () => {
    storage.map.set('cc.circlePolicy.bad', '{not json');
    storage.map.set('cc.availability', '}{');
    expect(await asyncKeyedIo('cc.circlePolicy.', storage).load('bad')).toBeNull();
    expect(await asyncFixedIo('cc.availability', storage).load()).toBeNull();
  });
});
