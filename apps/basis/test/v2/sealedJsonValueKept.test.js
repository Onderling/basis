/**
 * A SEALED VALUE THAT OPENS BUT IS NOT JSON IS KEPT, NOT WRITTEN OVER — and said.
 *
 * Thirteen stores read a key through the sealed key-value store and parsed it themselves: a value that opened but did
 * not parse (a newer build's shape, a torn write) read as null or `{}`, and the next save wrote over it. `kv.getJson`
 * is the one read they share now: it parses, and a value that does not parse is marked kept (every write to that key
 * refused, as for a value that will not open) and reported into the device's one notice under the store's kind.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { notReadableStores, resetNotReadableStores } from '@onderling/local-store';
import { setShellContentSeal, sealedKeyValue } from '../../src/v2/localStoreSeal.js';

const KEY = 'B'.repeat(43);
function rnStorage() {
  const m = new Map();
  return {
    raw: m,
    getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, String(v)); }, removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
  };
}

describe('kv.getJson', () => {
  beforeEach(() => { resetNotReadableStores(); setShellContentSeal(groupKeyStrategy({ groupKey: KEY })); });
  afterEach(() => setShellContentSeal(null));

  for (const strict of [true, false]) {
    it(`${strict ? 'strict' : 'non-strict'}: a value that opens but does not parse is kept, refused, and said`, async () => {
      const storage = rnStorage();
      const writer = sealedKeyValue(storage, { name: 'contact marks', strict, kind: 'messages' });
      await writer.setItem('cc-marks', '{"a": 1');   // a torn value, sealed as it was written
      const stored = storage.raw.get('cc-marks');

      const kv = sealedKeyValue(storage, { name: 'contact marks', strict, kind: 'messages' });
      expect(await kv.getJson('cc-marks')).toBeNull();
      await expect(kv.setItem('cc-marks', '{"b": 2}')).rejects.toThrow();
      expect(storage.raw.get('cc-marks')).toBe(stored);
      expect(notReadableStores()).toContainEqual({ name: 'contact marks: cc-marks', kind: 'messages', reason: 'unparseable' });
    });
  }

  it('a readable value parses, nothing is reported, and a save goes through', async () => {
    const storage = rnStorage();
    const kv = sealedKeyValue(storage, { name: 'x', strict: true, kind: 'settings' });
    await kv.setItem('k', '{"a":1}');
    expect(await kv.getJson('k')).toEqual({ a: 1 });
    await kv.setItem('k', '{"a":2}');
    expect(notReadableStores()).toEqual([]);
  });

  it('nothing stored is null, and not a refusal', async () => {
    const storage = rnStorage();
    const kv = sealedKeyValue(storage, { name: 'x', strict: true });
    expect(await kv.getJson('absent')).toBeNull();
    await kv.setItem('absent', '{}');
    expect(notReadableStores()).toEqual([]);
  });
});
