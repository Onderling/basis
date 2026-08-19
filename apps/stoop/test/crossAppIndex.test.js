/**
 * Phase 3.3b — cross-app type-index enumeration (the D3 standard:
 * any app enumerates every object of a canonical type regardless of
 * which app/member wrote it).
 *
 * No new production code is needed: with the Phase-1 CachingDataSource
 * `innerKeyMap` seam + the Phase-3.3a `fromInner` inverse,
 * `pullFromInner('<logical type prefix>')` already realizes it —
 * because containers are keyed by canonical TYPE (app-agnostic), so
 * listing the type's container yields ALL of its objects whoever
 * authored them. This test proves + locks that end-to-end against the
 * REAL `podPathMap` classify/reverseResolve through a real
 * `@onderling/local-store` CachingDataSource.
 */

import { describe, it, expect } from 'vitest';
import { CachingDataSource } from '@onderling/local-store';
import { classify, reverseResolve } from '../src/lib/podPathMap.js';

// pod-routing.resolve mirror (centralised on grp.pod).
const resolve = (fn) =>
  fn.startsWith('group/') ? `https://grp.pod/${fn.slice('group/'.length)}`
  : fn === 'private/state' ? 'https://my.pod/private/state'
  : null;

// The exact innerKeyMap Agent.js builds (classify+resolve+join /
// reverseResolve), bound to circle 'C'.
const circleId = 'C';
const innerKeyMap = {
  toInner: (p) => {
    const c = classify(p, { circleId });
    if (!c) return p;
    const b = resolve(c.storageFn);
    if (!b) return p;
    return b.endsWith('/') ? b + c.tail : `${b}/${c.tail}`;
  },
  fromInner: (u) => reverseResolve({ resolve, circleId, podUri: u }) ?? u,
};

function mkInner(seed) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    async read(u)  { return m.has(u) ? m.get(u) : null; },
    async write(u, d) { m.set(u, d); },
    async delete(u) { m.delete(u); },
    async list(p) { return [...m.keys()].filter((k) => k.startsWith(p)); },
  };
}

describe('Phase 3.3b — cross-app type-index via pullFromInner', () => {
  it('enumerates every object of a type regardless of authoring app', async () => {
    // The canonical circle `items` container holds objects written by
    // DIFFERENT apps (Stoop + a hypothetical other app following the
    // same type-keyed standard) — same container because it is keyed
    // by type, not by app.
    const inner = mkInner({
      'https://grp.pod/C/items/01STOOP.json': '{"origin":"stoop","kind":"share"}',
      'https://grp.pod/C/items/01OTHER.json': '{"origin":"other-app","kind":"borrow"}',
      'https://grp.pod/C/members/m1':         '{"id":"m1"}', // different type — must NOT leak in
    });
    const cache = new CachingDataSource({ inner, innerKeyMap });

    const n = await cache.pullFromInner('mem://neighbourhood/items/');
    expect(n).toBe(2);

    // Both re-keyed to the LOGICAL mem:// space, regardless of author.
    expect(await cache.read('mem://neighbourhood/items/01STOOP.json'))
      .toBe('{"origin":"stoop","kind":"share"}');
    expect(await cache.read('mem://neighbourhood/items/01OTHER.json'))
      .toBe('{"origin":"other-app","kind":"borrow"}');

    // Local listing (logical keys) shows exactly the two items —
    // the `members` resource was not in the items container.
    expect((await cache.list('mem://neighbourhood/items/')).sort()).toEqual([
      'mem://neighbourhood/items/01OTHER.json',
      'mem://neighbourhood/items/01STOOP.json',
    ]);
  });

  it('a different type prefix enumerates only that type', async () => {
    const inner = mkInner({
      'https://grp.pod/C/members/webid%3Alocal%3ApeerA': '{"p":"A"}',
      'https://grp.pod/C/members/webid%3Alocal%3ApeerB': '{"p":"B"}',
      'https://grp.pod/C/items/01X.json':                '{"k":"share"}',
    });
    const cache = new CachingDataSource({ inner, innerKeyMap });

    const n = await cache.pullFromInner('mem://neighbourhood/members/');
    expect(n).toBe(2);
    expect(await cache.read('mem://neighbourhood/members/webid%3Alocal%3ApeerA')).toBe('{"p":"A"}');
    expect((await cache.list('mem://neighbourhood/')).sort()).toEqual([
      'mem://neighbourhood/members/webid%3Alocal%3ApeerA',
      'mem://neighbourhood/members/webid%3Alocal%3ApeerB',
    ]);
  });
});
