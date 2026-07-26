import { describe, it, expect } from 'vitest';

import {
  objectDiff,
  isPlainObject,
  isKeyedArray,
  arrayById,
  deepEqual,
} from '../src/objectDiff.js';

describe('objectDiff — identity & no-op', () => {
  it('identical primitives → identical:true, empty buckets', () => {
    const out = objectDiff({ a: 1, b: 'x' }, { a: 1, b: 'x' }, { a: 1, b: 'x' });
    expect(out.identical).toBe(true);
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('identical nested objects → identical:true', () => {
    const o = { a: { b: { c: 7 } }, list: [1, 2, 3] };
    const out = objectDiff(o, JSON.parse(JSON.stringify(o)), JSON.parse(JSON.stringify(o)));
    expect(out.identical).toBe(true);
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('identical but base differs → still identical, but no entries (both already agree)', () => {
    // Both sides made the SAME edit from a different base.  Since local and
    // pod agree there's nothing to merge — already in agreement.
    const out = objectDiff({ a: 2 }, { a: 2 }, { a: 1 });
    expect(out.identical).toBe(true);
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });
});

describe('objectDiff — one-sided changes', () => {
  it('only local changed (pod === base) → toMerge with yours=local', () => {
    const out = objectDiff({ a: 'new' }, { a: 'old' }, { a: 'old' });
    expect(out.identical).toBe(false);
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([{ path: ['a'], yours: 'new', theirs: 'old', side: 'local' }]);
  });

  it('only pod changed (local === base) → toMerge with theirs=pod', () => {
    const out = objectDiff({ a: 'old' }, { a: 'new' }, { a: 'old' });
    expect(out.identical).toBe(false);
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([{ path: ['a'], yours: 'old', theirs: 'new', side: 'incoming' }]);
  });

  it('local-only addition (key absent in pod & base) → toMerge', () => {
    const out = objectDiff({ a: 1, b: 2 }, { a: 1 }, { a: 1 });
    expect(out.toMerge).toEqual([
      { path: ['b'], yours: 2, theirs: undefined, side: 'local' },
    ]);
    expect(out.conflicts).toEqual([]);
  });

  it('pod-only addition (key absent in local & base) → toMerge', () => {
    const out = objectDiff({ a: 1 }, { a: 1, b: 2 }, { a: 1 });
    expect(out.toMerge).toEqual([
      { path: ['b'], yours: undefined, theirs: 2, side: 'incoming' },
    ]);
    expect(out.conflicts).toEqual([]);
  });
});

describe('objectDiff — both-sided changes', () => {
  it('both changed differently → conflict with yours/theirs/base', () => {
    const out = objectDiff({ a: 'L' }, { a: 'P' }, { a: 'B' });
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([
      { path: ['a'], yours: 'L', theirs: 'P', base: 'B' },
    ]);
  });

  it('both changed identically → no entry (deepEqual short-circuits)', () => {
    // local === pod, even though both differ from base, is "already in
    // agreement" — nothing to merge or surface.
    const out = objectDiff({ a: 'same' }, { a: 'same' }, { a: 'B' });
    expect(out.identical).toBe(true);
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });
});

describe('objectDiff — nested paths', () => {
  it('deeply nested change → correct path array', () => {
    const out = objectDiff(
      { a: { b: { c: 2, d: 9 } } },
      { a: { b: { c: 1, d: 9 } } },
      { a: { b: { c: 1, d: 9 } } },
    );
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      { path: ['a', 'b', 'c'], yours: 2, theirs: 1, side: 'local' },
    ]);
  });

  it('deeply nested conflict → correct path array', () => {
    const out = objectDiff(
      { a: { b: { c: 'L' } } },
      { a: { b: { c: 'P' } } },
      { a: { b: { c: 'B' } } },
    );
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([
      { path: ['a', 'b', 'c'], yours: 'L', theirs: 'P', base: 'B' },
    ]);
  });
});

describe('objectDiff — arrays keyed by id', () => {
  it('add a new block on local only → toMerge at that block id', () => {
    const base = { blocks: [{ id: 'b1', type: 'noticeboard' }] };
    const pod  = { blocks: [{ id: 'b1', type: 'noticeboard' }] };
    const local = {
      blocks: [
        { id: 'b1', type: 'noticeboard' },
        { id: 'b2', type: 'recipe', config: { title: 'New' } },
      ],
    };
    const out = objectDiff(local, pod, base);
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      {
        path: ['blocks', 'b2'],
        yours: { id: 'b2', type: 'recipe', config: { title: 'New' } },
        theirs: undefined,
        side: 'local',
      },
    ]);
  });

  it('same block edited on both sides differently → conflict on that block path', () => {
    const base = { blocks: [{ id: 'b1', config: { title: 'Old' } }] };
    const local = { blocks: [{ id: 'b1', config: { title: 'Local' } }] };
    const pod   = { blocks: [{ id: 'b1', config: { title: 'Pod'   } }] };
    const out = objectDiff(local, pod, base);
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([
      {
        path: ['blocks', 'b1', 'config', 'title'],
        yours: 'Local',
        theirs: 'Pod',
        base: 'Old',
      },
    ]);
  });

  it('keyed array — one block removed locally → toMerge yours=undefined', () => {
    const base = { blocks: [{ id: 'b1' }, { id: 'b2' }] };
    const pod  = { blocks: [{ id: 'b1' }, { id: 'b2' }] };
    const local = { blocks: [{ id: 'b1' }] };
    const out = objectDiff(local, pod, base);
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      { path: ['blocks', 'b2'], yours: undefined, theirs: { id: 'b2' }, side: 'local' },
    ]);
  });

  it('disjoint adds on both sides → two toMerge entries, no conflict', () => {
    const base = { blocks: [{ id: 'b1' }] };
    const local = { blocks: [{ id: 'b1' }, { id: 'b2', x: 1 }] };
    const pod   = { blocks: [{ id: 'b1' }, { id: 'b3', y: 2 }] };
    const out = objectDiff(local, pod, base);
    expect(out.conflicts).toEqual([]);
    // Order of toMerge entries reflects Set iteration order: b1, b2, b3 → b2, b3 survive
    expect(out.toMerge).toHaveLength(2);
    const byId = Object.fromEntries(out.toMerge.map((m) => [m.path[1], m]));
    expect(byId.b2).toEqual({
      path: ['blocks', 'b2'],
      yours: { id: 'b2', x: 1 },
      theirs: undefined,
      side: 'local',
    });
    expect(byId.b3).toEqual({
      path: ['blocks', 'b3'],
      yours: undefined,
      theirs: { id: 'b3', y: 2 },
      side: 'incoming',
    });
  });
});

describe('objectDiff — opaque arrays (no `id`)', () => {
  it('array of plain values (no id) → whole-array opaque diff', () => {
    const out = objectDiff(
      { tags: ['a', 'b', 'c'] },
      { tags: ['a', 'b'] },
      { tags: ['a', 'b'] },
    );
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      { path: ['tags'], yours: ['a', 'b', 'c'], theirs: ['a', 'b'], side: 'local' },
    ]);
  });

  it('array of objects WITHOUT id on every entry → opaque', () => {
    const out = objectDiff(
      { rows: [{ x: 1 }, { x: 2 }] },
      { rows: [{ x: 1 }] },
      { rows: [{ x: 1 }] },
    );
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      { path: ['rows'], yours: [{ x: 1 }, { x: 2 }], theirs: [{ x: 1 }], side: 'local' },
    ]);
  });

  it('opaque array conflict — both changed', () => {
    const out = objectDiff(
      { tags: ['a', 'b', 'L'] },
      { tags: ['a', 'b', 'P'] },
      { tags: ['a', 'b'] },
    );
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([
      {
        path: ['tags'],
        yours: ['a', 'b', 'L'],
        theirs: ['a', 'b', 'P'],
        base: ['a', 'b'],
      },
    ]);
  });
});

describe('objectDiff — missing base', () => {
  it('null base — identical inputs → identical:true', () => {
    const out = objectDiff({ a: 1 }, { a: 1 }, null);
    expect(out.identical).toBe(true);
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('null base — local-only key → toMerge (one-sided add)', () => {
    const out = objectDiff({ a: 1, b: 2 }, { a: 1 }, null);
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      { path: ['b'], yours: 2, theirs: undefined, side: 'local' },
    ]);
  });

  it('null base — both sides have different non-empty values → conflict', () => {
    const out = objectDiff({ a: 'L' }, { a: 'P' }, null);
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([
      { path: ['a'], yours: 'L', theirs: 'P', base: undefined },
    ]);
  });
});

describe('objectDiff — primitives', () => {
  it('number === comparison', () => {
    const out = objectDiff({ n: 1 }, { n: 1.0 }, { n: 1 });
    expect(out.identical).toBe(true);
  });

  it('bool change → toMerge', () => {
    const out = objectDiff({ b: true }, { b: false }, { b: false });
    expect(out.toMerge).toEqual([{ path: ['b'], yours: true, theirs: false, side: 'local' }]);
  });

  it('null vs undefined are distinct', () => {
    const out = objectDiff({ x: null }, { x: undefined }, { x: null });
    // x was `null` on base + local, became `undefined` on pod → pod-only change.
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      { path: ['x'], yours: null, theirs: undefined, side: 'incoming' },
    ]);
  });
});

describe('objectDiff — undefined vs missing key', () => {
  it('key undefined on one side, missing on the other → treated identically', () => {
    // local lacks `b`; pod has `b: undefined`; base lacks `b`.
    // All three encode the same "no value" — nothing to emit.
    const out = objectDiff({ a: 1 }, { a: 1, b: undefined }, { a: 1 });
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('key that disappeared on one side that was already undefined → no-op', () => {
    // base has `b: undefined`; local drops the key entirely; pod keeps `b: undefined`.
    const out = objectDiff({ a: 1 }, { a: 1, b: undefined }, { a: 1, b: undefined });
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });
});

describe('objectDiff — deletions', () => {
  it('base has key, local missing, pod unchanged → toMerge (local-only delete)', () => {
    const out = objectDiff({ a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2 });
    expect(out.conflicts).toEqual([]);
    expect(out.toMerge).toEqual([
      { path: ['b'], yours: undefined, theirs: 2, side: 'local' },
    ]);
  });

  it('local deletes, pod edits same key → conflict', () => {
    const out = objectDiff({ a: 1 }, { a: 1, b: 'pod' }, { a: 1, b: 'old' });
    expect(out.toMerge).toEqual([]);
    expect(out.conflicts).toEqual([
      { path: ['b'], yours: undefined, theirs: 'pod', base: 'old' },
    ]);
  });
});

describe('helpers', () => {
  it('isPlainObject', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject('s')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });

  it('isKeyedArray — every entry must be a plain object with string id', () => {
    expect(isKeyedArray([])).toBe(true); // vacuous
    expect(isKeyedArray([{ id: 'a' }, { id: 'b' }])).toBe(true);
    expect(isKeyedArray([{ id: 'a' }, { foo: 1 }])).toBe(false);
    expect(isKeyedArray([{ id: 1 }])).toBe(false); // number id
    expect(isKeyedArray([1, 2, 3])).toBe(false);
    expect(isKeyedArray('not-array')).toBe(false);
  });

  it('arrayById — duplicate ids are last-write-wins', () => {
    const m = arrayById([{ id: 'a', v: 1 }, { id: 'a', v: 2 }, { id: 'b', v: 3 }]);
    expect(m.get('a')).toEqual({ id: 'a', v: 2 });
    expect(m.get('b')).toEqual({ id: 'b', v: 3 });
  });

  it('deepEqual — primitives, arrays, objects, mixed', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false); // different key counts
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(new Date(0), new Date(0))).toBe(true);
    expect(deepEqual(new Date(0), new Date(1))).toBe(false);
  });
});
