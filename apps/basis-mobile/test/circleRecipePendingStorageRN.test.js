/**
 * basis-mobile · γ-next.recipe — AsyncStorage adapter round-trip.
 *
 * Mirrors `apps/basis/test/v2/circleRecipePendingStorage.test.js`
 * so the wire-level key shape (`cc.circleRecipePending.<circleId>`) is
 * identical on both surfaces.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  asyncStorageCircleRecipePendingIo,
  makeCircleRecipePendingStoreRN,
} from '../src/core/circleRecipePendingStorageRN.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

describe('γ-next.recipe — circleRecipePendingStorageRN', () => {
  let storage;
  beforeEach(() => { storage = mockAsyncStorage(); });

  it('round-trips a recipe through save / load', async () => {
    const io = asyncStorageCircleRecipePendingIo(storage);
    await io.save('g1', { id: 'r1', name: 'Buurt', blocks: [] });
    expect(storage.map.get('cc.circleRecipePending.g1')).toBe(
      JSON.stringify({ id: 'r1', name: 'Buurt', blocks: [] }),
    );
    expect(await io.load('g1')).toEqual({ id: 'r1', name: 'Buurt', blocks: [] });
  });

  it('returns null when no entry', async () => {
    const io = asyncStorageCircleRecipePendingIo(storage);
    expect(await io.load('missing')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    await storage.setItem('cc.circleRecipePending.g2', 'not json');
    const io = asyncStorageCircleRecipePendingIo(storage);
    expect(await io.load('g2')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const io = asyncStorageCircleRecipePendingIo(storage);
    await io.save('g3', { id: 'r' });
    await io.remove('g3');
    expect(storage.map.has('cc.circleRecipePending.g3')).toBe(false);
    expect(await io.load('g3')).toBeNull();
  });

  it('factory makeCircleRecipePendingStoreRN binds AsyncStorage IO', async () => {
    const store = makeCircleRecipePendingStoreRN(storage);
    await store.set('g4', { id: 'r4' });
    expect(await store.get('g4')).toEqual({ id: 'r4' });
    await store.clear('g4');
    expect(await store.get('g4')).toBeNull();
  });
});
