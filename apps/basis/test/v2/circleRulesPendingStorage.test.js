/**
 * basis v2 — γ-next.rules localStorage adapter tests.
 *
 * Verifies the wire-level keys (`cc.circleRulesPending.<id>`), JSON
 * round-trip, and the missing-key / clear semantics.  Uses a vi-mock
 * `storage` rather than jsdom so the test is fast + node-portable.
 */
import { describe, it, expect } from 'vitest';
import {
  localStorageCircleRulesPendingIo,
  createCircleRulesPendingStoreLocal,
} from '../../src/v2/circleRulesPendingStorage.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _backing: m,
  };
}

describe('localStorageCircleRulesPendingIo · γ-next.rules', () => {
  it('writes to cc.circleRulesPending.<id> as JSON', async () => {
    const s = memStorage();
    const io = localStorageCircleRulesPendingIo(s);
    await io.save('g1', { purpose: 'Neighbourhood', agreements: 'be kind' });
    expect(s._backing.get('cc.circleRulesPending.g1')).toBe(
      JSON.stringify({ purpose: 'Neighbourhood', agreements: 'be kind' }),
    );
  });

  it('reads back the same shape', async () => {
    const s = memStorage();
    const io = localStorageCircleRulesPendingIo(s);
    await io.save('g2', { purpose: 'r2', admins: 'two' });
    expect(await io.load('g2')).toEqual({
      purpose: 'r2', admins: 'two',
    });
  });

  it('returns null when the key is missing', async () => {
    const io = localStorageCircleRulesPendingIo(memStorage());
    expect(await io.load('nope')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    const s = memStorage();
    s.setItem('cc.circleRulesPending.g3', 'not json');
    const io = localStorageCircleRulesPendingIo(s);
    expect(await io.load('g3')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const s = memStorage();
    const io = localStorageCircleRulesPendingIo(s);
    await io.save('g4', { purpose: 'r' });
    await io.remove('g4');
    expect(s._backing.has('cc.circleRulesPending.g4')).toBe(false);
    expect(await io.load('g4')).toBeNull();
  });

  it('factory createCircleRulesPendingStoreLocal binds localStorage IO', async () => {
    const s = memStorage();
    const store = createCircleRulesPendingStoreLocal(s);
    await store.set('g5', { purpose: 'r5' });
    expect(await store.get('g5')).toEqual({ purpose: 'r5' });
    await store.clear('g5');
    expect(await store.get('g5')).toBeNull();
  });
});
