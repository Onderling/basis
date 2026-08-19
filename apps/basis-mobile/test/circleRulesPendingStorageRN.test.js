/**
 * basis-mobile · γ-next.rules — AsyncStorage adapter round-trip.
 *
 * Mirrors `apps/basis/test/v2/circleRulesPendingStorage.test.js`
 * so the wire-level key shape (`cc.circleRulesPending.<circleId>`) is
 * identical on both surfaces.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  asyncStorageCircleRulesPendingIo,
  makeCircleRulesPendingStoreRN,
} from '../src/core/circleRulesPendingStorageRN.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

describe('γ-next.rules — circleRulesPendingStorageRN', () => {
  let storage;
  beforeEach(() => { storage = mockAsyncStorage(); });

  it('round-trips a rules doc through save / load', async () => {
    const io = asyncStorageCircleRulesPendingIo(storage);
    await io.save('g1', { purpose: 'Buurt', agreements: 'be kind' });
    expect(storage.map.get('cc.circleRulesPending.g1')).toBe(
      JSON.stringify({ purpose: 'Buurt', agreements: 'be kind' }),
    );
    expect(await io.load('g1')).toEqual({ purpose: 'Buurt', agreements: 'be kind' });
  });

  it('returns null when no entry', async () => {
    const io = asyncStorageCircleRulesPendingIo(storage);
    expect(await io.load('missing')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    await storage.setItem('cc.circleRulesPending.g2', 'not json');
    const io = asyncStorageCircleRulesPendingIo(storage);
    expect(await io.load('g2')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const io = asyncStorageCircleRulesPendingIo(storage);
    await io.save('g3', { purpose: 'r' });
    await io.remove('g3');
    expect(storage.map.has('cc.circleRulesPending.g3')).toBe(false);
    expect(await io.load('g3')).toBeNull();
  });

  it('factory makeCircleRulesPendingStoreRN binds AsyncStorage IO', async () => {
    const store = makeCircleRulesPendingStoreRN(storage);
    await store.set('g4', { purpose: 'r4' });
    expect(await store.get('g4')).toEqual({ purpose: 'r4' });
    await store.clear('g4');
    expect(await store.get('g4')).toBeNull();
  });
});
