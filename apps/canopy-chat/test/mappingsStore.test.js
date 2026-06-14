/**
 * localStorageMappingsStore — the V0 web storage adapter (P2c). Verified in
 * isolation against the pseudo-pod subset contract (list/read/write/delete,
 * keys == URIs) so `@canopy/pod-routing` loadMappings can drive it unchanged.
 */

import { describe, it, expect } from 'vitest';
import { localStorageMappingsStore, WEB_MAPPINGS_DEVICE } from '../src/v2/mappingsStore.js';

/** Minimal localStorage fake (getItem/setItem/removeItem/key/length). */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const CONTAINER = `pseudo-pod://${WEB_MAPPINGS_DEVICE}/private/mappings/`;
const uriFor = (id) => `${CONTAINER}${id}`;

describe('localStorageMappingsStore', () => {
  it('write → read round-trips a JSON body', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    await store.write(uriFor('a'), { id: 'a', n: 1 });
    expect((await store.read(uriFor('a'))).bytes).toEqual({ id: 'a', n: 1 });
  });

  it('read of a missing uri returns null', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    expect(await store.read(uriFor('nope'))).toBeNull();
  });

  it('list returns the bare URIs under the container (sorted), readable back', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    await store.write(uriFor('b'), { id: 'b' });
    await store.write(uriFor('a'), { id: 'a' });
    const uris = await store.list(CONTAINER);
    expect(uris).toEqual([uriFor('a'), uriFor('b')]);
    // each listed uri must read back (loadMappings relies on this)
    expect((await store.read(uris[0])).bytes).toEqual({ id: 'a' });
  });

  it('list ignores keys outside the container + delete removes', async () => {
    const storage = fakeStorage();
    const store = localStorageMappingsStore(storage);
    await store.write(uriFor('keep'), { id: 'keep' });
    storage.setItem('unrelated.key', 'x');
    await store.delete(uriFor('keep'));
    expect(await store.list(CONTAINER)).toEqual([]);
  });
});
