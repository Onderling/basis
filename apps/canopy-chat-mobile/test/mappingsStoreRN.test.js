/**
 * asyncStorageMappingsStore — the V0 mobile (AsyncStorage) mappings store. Verified
 * against the pseudo-pod subset contract (list/read/write/delete, keys == URIs) with
 * an injected fake AsyncStorage, so `@canopy/pod-routing` loadMappings drives it.
 */

import { describe, it, expect } from 'vitest';
import { asyncStorageMappingsStore, MAPPINGS_DEVICE } from '../src/core/mappingsStoreRN.js';

/** Minimal async AsyncStorage fake (getItem/setItem/removeItem/getAllKeys). */
function fakeAsyncStorage() {
  const map = new Map();
  return {
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => { map.set(k, String(v)); },
    removeItem: async (k) => { map.delete(k); },
    getAllKeys: async () => [...map.keys()],
  };
}

const CONTAINER = `pseudo-pod://${MAPPINGS_DEVICE}/private/mappings/`;
const uriFor = (id) => `${CONTAINER}${id}`;

describe('asyncStorageMappingsStore', () => {
  it('write → read round-trips a JSON body', async () => {
    const store = asyncStorageMappingsStore(fakeAsyncStorage());
    await store.write(uriFor('a'), { id: 'a', n: 1 });
    expect((await store.read(uriFor('a'))).bytes).toEqual({ id: 'a', n: 1 });
  });

  it('read of a missing uri returns null', async () => {
    const store = asyncStorageMappingsStore(fakeAsyncStorage());
    expect(await store.read(uriFor('nope'))).toBeNull();
  });

  it('list returns the bare URIs under the container (sorted), readable back', async () => {
    const store = asyncStorageMappingsStore(fakeAsyncStorage());
    await store.write(uriFor('b'), { id: 'b' });
    await store.write(uriFor('a'), { id: 'a' });
    const uris = await store.list(CONTAINER);
    expect(uris).toEqual([uriFor('a'), uriFor('b')]);
    expect((await store.read(uris[0])).bytes).toEqual({ id: 'a' });
  });

  it('list ignores keys outside the container + delete removes', async () => {
    const storage = fakeAsyncStorage();
    const store = asyncStorageMappingsStore(storage);
    await store.write(uriFor('keep'), { id: 'keep' });
    await storage.setItem('unrelated.key', 'x');
    await store.delete(uriFor('keep'));
    expect(await store.list(CONTAINER)).toEqual([]);
  });
});
