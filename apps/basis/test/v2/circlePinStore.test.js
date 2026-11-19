/**
 * β.5 — circlePinStore: per-user "pin to top" map persistence.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { createCirclePinStore, localStoragePinIo } from '../../src/v2/circlePinStore.js';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';

// the pins are sealed at rest (ledger L1083): a content key is published, as after a boot
const SEAL = groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') });
beforeAll(() => setShellContentSeal(SEAL));
afterAll(() => setShellContentSeal(null));

describe('createCirclePinStore', () => {
  it('get() returns {} when storage is empty / load returns null', async () => {
    const store = createCirclePinStore({ load: async () => null });
    expect(await store.get()).toEqual({});
  });

  it('get() returns {} when no IO is wired', async () => {
    const store = createCirclePinStore();
    expect(await store.get()).toEqual({});
  });

  it('toggle() flips a circle on and off, persisting through save', async () => {
    let mem = null;
    const store = createCirclePinStore({
      load: async () => mem,
      save: async (v) => { mem = v; },
    });
    const after1 = await store.toggle('c1');
    expect(after1).toEqual({ c1: true });
    expect(mem).toEqual({ c1: true });

    const after2 = await store.toggle('c2');
    expect(after2).toEqual({ c1: true, c2: true });
    expect(mem).toEqual({ c1: true, c2: true });

    const after3 = await store.toggle('c1');
    expect(after3).toEqual({ c2: true });
    expect(mem).toEqual({ c2: true });
  });

  it('isPinned() reflects the latest toggle', async () => {
    let mem = null;
    const store = createCirclePinStore({
      load: async () => mem,
      save: async (v) => { mem = v; },
    });
    expect(await store.isPinned('c1')).toBe(false);
    await store.toggle('c1');
    expect(await store.isPinned('c1')).toBe(true);
    await store.toggle('c1');
    expect(await store.isPinned('c1')).toBe(false);
  });

  it('toggle() ignores empty / non-string ids defensively', async () => {
    let mem = null;
    const store = createCirclePinStore({
      load: async () => mem,
      save: async (v) => { mem = v; },
    });
    const after = await store.toggle('');
    expect(after).toEqual({});
    expect(mem).toBeNull(); // never wrote
  });

  it('tolerates a throwing load (falls back to {})', async () => {
    const store = createCirclePinStore({ load: async () => { throw new Error('x'); } });
    expect(await store.get()).toEqual({});
  });

  it('drops corrupt entries (non-truthy / array / non-string keys) on read', async () => {
    const store = createCirclePinStore({ load: async () => ({ c1: true, c2: false, c3: null, c4: 1 }) });
    // Truthy-only — `1` keeps c4, false/null drop c2/c3.
    expect(await store.get()).toEqual({ c1: true, c4: true });
  });

  it('treats array / non-object stored data as empty', async () => {
    const store1 = createCirclePinStore({ load: async () => ['c1'] });
    expect(await store1.get()).toEqual({});
    const store2 = createCirclePinStore({ load: async () => 'nope' });
    expect(await store2.get()).toEqual({});
  });
});

describe('localStoragePinIo', () => {
  it('round-trips through a Storage-like backend at cc.circlePinned', async () => {
    const map = new Map();
    const storage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
    };
    const io = localStoragePinIo(storage);
    await io.save({ c1: true });
    expect(await io.load()).toEqual({ c1: true });
    expect(map.has('cc.circlePinned')).toBe(true);
  });

  it('an old plain value is read once and resealed', async () => {
    const map = new Map([['cc.circlePinned', JSON.stringify({ c9: true })]]);
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
    expect(await localStoragePinIo(storage).load()).toEqual({ c9: true });
    expect(map.get('cc.circlePinned')).not.toContain('c9');
    expect(JSON.parse(SEAL.open(map.get('cc.circlePinned')))).toEqual({ c9: true });
  });

  it('load returns null for missing / corrupt entries', async () => {
    const storage = { getItem: () => 'not json{', setItem: () => {} };
    expect(await localStoragePinIo(storage).load()).toBeNull();
  });

  it('save tolerates a throwing storage (quota / disabled)', async () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    };
    // Doesn't throw.
    await expect(localStoragePinIo(storage).save({ c1: true })).resolves.toBeUndefined();
  });
});

describe('createCirclePinStore × localStoragePinIo integration', () => {
  it('toggle + isPinned survive a fresh store instance over the same storage', async () => {
    const map = new Map();
    const storage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
    };
    const a = createCirclePinStore(localStoragePinIo(storage));
    await a.toggle('c1');
    const b = createCirclePinStore(localStoragePinIo(storage));
    expect(await b.isPinned('c1')).toBe(true);
  });
});
