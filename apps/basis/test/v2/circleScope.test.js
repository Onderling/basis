import { describe, it, expect, beforeEach } from 'vitest';
import { itemCircleId, isInCircle, scopeItems, normalizeAudienceRef } from '../../src/v2/circleScope.js';
import {
  getActiveCircle, setActiveCircle, subscribeActiveCircle,
} from '../../src/v2/activeCircle.js';

describe('circleScope · itemCircleId', () => {
  it('reads circleId / circleId (alias) / groupId', () => {
    expect(itemCircleId({ circleId: 'a' })).toBe('a');
    expect(itemCircleId({ circleId: 'b' })).toBe('b');
    expect(itemCircleId({ groupId: 'c' })).toBe('c');
  });
  it('reads circle:/circle: audience shorthands and circle-ref objects', () => {
    expect(itemCircleId({ audience: 'circle:x' })).toBe('x');
    expect(itemCircleId({ audience: 'circle:y' })).toBe('y');
    expect(itemCircleId({ audience: { kind: 'circle-ref', id: 'z' } })).toBe('z');
  });
  it('returns null for unscoped / unrelated audiences', () => {
    expect(itemCircleId({})).toBeNull();
    expect(itemCircleId({ audience: 'public' })).toBeNull();
    expect(itemCircleId({ audience: 'role:admin' })).toBeNull();
  });
});

describe('circleScope · normalizeAudienceRef', () => {
  it('canonicalises the circle: short-hand to a structured circle-ref', () => {
    expect(normalizeAudienceRef('circle:abc')).toEqual({ kind: 'circle-ref', id: 'abc' });
  });
  it('is idempotent on an already-structured circle-ref', () => {
    const ref = { kind: 'circle-ref', id: 'abc' };
    expect(normalizeAudienceRef(ref)).toBe(ref);   // returned verbatim
  });
  it('leaves other short-hands and the set shape untouched', () => {
    expect(normalizeAudienceRef('household')).toBe('household');
    expect(normalizeAudienceRef('role:admin')).toBe('role:admin');
    expect(normalizeAudienceRef('public')).toBe('public');
    const set = { kind: 'set', members: ['webid:a'] };
    expect(normalizeAudienceRef(set)).toBe(set);
  });

  it('recurses into a union: canonicalises each circle: member', () => {
    const union = { kind: 'union', of: ['household', 'circle:abc'] };
    expect(normalizeAudienceRef(union)).toEqual({
      kind: 'union',
      of: ['household', { kind: 'circle-ref', id: 'abc' }],
    });
  });
});

describe('circleScope · isInCircle / scopeItems', () => {
  const items = [
    { id: 1, circleId: 'home' },
    { id: 2, circleId: 'home' },        // alias → same circle
    { id: 3, audience: 'circle:circle' },
    { id: 4 },                        // unscoped item
  ];
  it('null active circle keeps everything', () => {
    expect(isInCircle({ circleId: 'home' }, null)).toBe(true);
    expect(scopeItems(items, null)).toHaveLength(4);
  });
  it('filters to the active circle (circleId aliases circleId)', () => {
    expect(scopeItems(items, 'home').map((i) => i.id)).toEqual([1, 2]);
    expect(scopeItems(items, 'circle').map((i) => i.id)).toEqual([3]);
  });
  it('tolerates non-array input', () => {
    expect(scopeItems(undefined, 'home')).toEqual([]);
  });
});

describe('activeCircle store', () => {
  beforeEach(() => setActiveCircle(null));

  it('gets/sets and normalises empty → null', () => {
    expect(getActiveCircle()).toBeNull();
    setActiveCircle('home');
    expect(getActiveCircle()).toBe('home');
    setActiveCircle('');
    expect(getActiveCircle()).toBeNull();
  });

  it('notifies subscribers on change, not on no-op, and unsubscribes', () => {
    const seen = [];
    const off = subscribeActiveCircle((c) => seen.push(c));
    setActiveCircle('a');
    setActiveCircle('a');     // no-op, no notify
    setActiveCircle('b');
    off();
    setActiveCircle('c');     // after unsubscribe → not seen
    expect(seen).toEqual(['a', 'b']);
  });
});
