/** The web mappings store writes under the namespace its app hands it, and keeps a neutral one of its own. */
import { describe, it, expect } from 'vitest';
import { localStorageMappingsStore, DEFAULT_MAPPINGS_PREFIX } from '../src/mappingsStore.js';

function memStorage() {
  const m = new Map();
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe('localStorageMappingsStore', () => {
  it('writes under its own default namespace when none is given', async () => {
    const s = memStorage();
    await localStorageMappingsStore(s).write('mem://x/a', { a: 1 });
    expect([...s.m.keys()]).toEqual([`${DEFAULT_MAPPINGS_PREFIX}mem://x/a`]);
  });

  it('writes, reads and lists under the prefix an app hands it', async () => {
    const s = memStorage();
    const store = localStorageMappingsStore(s, { prefix: 'app.mappings:' });
    await store.write('mem://x/a', { a: 1 });
    expect([...s.m.keys()]).toEqual(['app.mappings:mem://x/a']);
    expect((await store.read('mem://x/a')).bytes).toEqual({ a: 1 });
    expect(await store.list('mem://x/')).toEqual(['mem://x/a']);
  });
});
