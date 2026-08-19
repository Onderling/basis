/**
 * basis-mobile · γ-next.policy — AsyncStorage adapter round-trip.
 *
 * Mirrors `apps/basis/test/v2/circlePolicyPendingStorage.test.js`
 * so the wire-level key shape (`cc.circlePolicyPending.<circleId>`) is
 * identical on both surfaces.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  asyncStorageCirclePolicyPendingIo,
  makeCirclePolicyPendingStoreRN,
} from '../src/core/circlePolicyPendingStorageRN.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

describe('γ-next.policy — circlePolicyPendingStorageRN', () => {
  let storage;
  beforeEach(() => { storage = mockAsyncStorage(); });

  it('round-trips a policy doc through save / load', async () => {
    const io = asyncStorageCirclePolicyPendingIo(storage);
    await io.save('g1', { view: 'screen', features: { chat: true } });
    expect(storage.map.get('cc.circlePolicyPending.g1')).toBe(
      JSON.stringify({ view: 'screen', features: { chat: true } }),
    );
    expect(await io.load('g1')).toEqual({ view: 'screen', features: { chat: true } });
  });

  it('returns null when no entry', async () => {
    const io = asyncStorageCirclePolicyPendingIo(storage);
    expect(await io.load('missing')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    await storage.setItem('cc.circlePolicyPending.g2', 'not json');
    const io = asyncStorageCirclePolicyPendingIo(storage);
    expect(await io.load('g2')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const io = asyncStorageCirclePolicyPendingIo(storage);
    await io.save('g3', { view: 'screen' });
    await io.remove('g3');
    expect(storage.map.has('cc.circlePolicyPending.g3')).toBe(false);
    expect(await io.load('g3')).toBeNull();
  });

  it('factory makeCirclePolicyPendingStoreRN binds AsyncStorage IO', async () => {
    const store = makeCirclePolicyPendingStoreRN(storage);
    await store.set('g4', { view: 'chat' });
    expect(await store.get('g4')).toEqual({ view: 'chat' });
    await store.clear('g4');
    expect(await store.get('g4')).toBeNull();
  });
});
