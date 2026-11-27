/**
 * localStoragePeerBackend — round-trips the PeerGraph storageBackend contract
 * over a fake (Map-backed) localStorage, and proves persistence: a fresh
 * PeerGraph over the same backend rehydrates prior peers (the reload-survival
 * the v2 Contacten roster needed).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PeerGraph } from '@onderling/core';
import { createLocalStoragePeerBackend } from '../../src/web/localStoragePeerBackend.js';

/** Minimal Map-backed Storage shim with the surface the backend uses. */
function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _map: map,
  };
}

describe('createLocalStoragePeerBackend', () => {
  let storage;
  let backend;

  beforeEach(() => {
    storage = fakeLocalStorage();
    backend = createLocalStoragePeerBackend({ storage });
  });

  it('round-trips get/set/delete with the prefix', async () => {
    expect(await backend.get('peer:abc')).toBeNull();

    await backend.set('peer:abc', JSON.stringify({ pubKey: 'abc' }));
    expect(await backend.get('peer:abc')).toBe(JSON.stringify({ pubKey: 'abc' }));
    // physically namespaced under the prefix in the underlying store
    expect(storage._map.has('basis.peers:peer:abc')).toBe(true);

    await backend.delete('peer:abc');
    expect(await backend.get('peer:abc')).toBeNull();
  });

  it('list() returns stored keys with the prefix stripped', async () => {
    await backend.set('peer:one', JSON.stringify({ pubKey: 'one' }));
    await backend.set('peer:two', JSON.stringify({ pubKey: 'two' }));
    const keys = await backend.list();
    expect(keys.sort()).toEqual(['peer:one', 'peer:two']);
  });

  it('honours a custom prefix and ignores foreign keys', async () => {
    const b = createLocalStoragePeerBackend({ prefix: 'other:', storage });
    storage.setItem('unrelated', 'x');          // foreign, no prefix
    await b.set('peer:z', JSON.stringify({ pubKey: 'z' }));
    expect(await b.list()).toEqual(['peer:z']);
  });

  it('falls back to an in-memory store when localStorage is unavailable', async () => {
    // No `storage` passed and no globalThis.localStorage in the node test env.
    const b = createLocalStoragePeerBackend();
    await b.set('peer:m', JSON.stringify({ pubKey: 'm' }));
    expect(await b.get('peer:m')).toBe(JSON.stringify({ pubKey: 'm' }));
    expect(await b.list()).toEqual(['peer:m']);
  });
});

describe('PeerGraph over localStoragePeerBackend', () => {
  it('rehydrates: a fresh PeerGraph over the same backend sees prior peers', async () => {
    const storage = fakeLocalStorage();
    const backend = createLocalStoragePeerBackend({ storage });

    const g = new PeerGraph({ storageBackend: backend });
    await g.upsert({ pubKey: 'abc', label: 'Alice' });
    await g.upsert({ pubKey: 'def', label: 'Bob' });

    // Simulate a reload: brand-new graph, SAME backing store.
    const g2 = new PeerGraph({ storageBackend: backend });
    const all = await g2.all();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.pubKey).sort()).toEqual(['abc', 'def']);
    expect((await g2.get('abc')).label).toBe('Alice');
  });

  it('removal persists across a fresh graph', async () => {
    const storage = fakeLocalStorage();
    const backend = createLocalStoragePeerBackend({ storage });

    const g = new PeerGraph({ storageBackend: backend });
    await g.upsert({ pubKey: 'abc' });
    await g.remove('abc');

    const g2 = new PeerGraph({ storageBackend: backend });
    expect(await g2.all()).toHaveLength(0);
  });
});
