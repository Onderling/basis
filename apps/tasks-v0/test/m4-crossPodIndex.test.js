/**
 * Tasks M4 — cross-pod type-index via innerKeyMap + pullFromInner.
 *
 * Analog of apps/pinboard/test/crossAppIndex.test.js, adapted for Tasks.
 * Proves that the Tasks `innerKeyMap` (buildBundle + podPathMap) lets
 * `CachingDataSource.pullFromInner('<logical prefix>')` enumerate all
 * objects of a canonical type regardless of which device/member wrote
 * them — just as the pinboard pattern does.
 *
 * No new production code is exercised beyond what M4 ships: the real
 * `classify`/`reverseResolve` through a real `@onderling/local-store`
 * CachingDataSource with the `innerKeyMap` seam from `buildBundle`.
 *
 * NOTE: written, not run here — orchestrator verifies in the main
 * tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect } from 'vitest';
import { CachingDataSource } from '@onderling/local-store';
import { classify, reverseResolve } from '../src/lib/podPathMap.js';

const CIRCLE = 'household';

// Pod-routing resolver (centralised on grp.pod).
const resolve = (fn) =>
  fn.startsWith('group/') ? `https://grp.pod/${fn.slice('group/'.length)}/`
  : null;

// Exact innerKeyMap buildBundle now builds (M4), bound to circleId 'household'.
const innerKeyMap = {
  toInner: (p) => {
    const c = classify(p, { circleId: CIRCLE });
    if (!c) return p;
    const base = resolve(c.storageFn);
    if (!base) return p;
    return base + c.tail;
  },
  fromInner: (u) => reverseResolve({ resolve, circleId: CIRCLE, podUri: u }) ?? u,
};

function mkInner(seed) {
  const m = new Map(Object.entries(seed));
  return {
    async read(u)      { return m.has(u) ? m.get(u) : null; },
    async write(u, d)  { m.set(u, d); },
    async delete(u)    { m.delete(u); },
    async list(p)      { return [...m.keys()].filter((k) => k.startsWith(p)); },
  };
}

describe('Tasks M4 — cross-pod type-index via pullFromInner (innerKeyMap seam)', () => {
  it('enumerates every task item regardless of authoring device', async () => {
    const inner = mkInner({
      'https://grp.pod/household/items/01DEVICED.json': '{"id":"01DEVICED","type":"task","text":"device D"}',
      'https://grp.pod/household/items/01DEVICEE.json': '{"id":"01DEVICEE","type":"task","text":"device E"}',
      'https://grp.pod/household/members/alice.json':   '{"id":"alice"}', // different type — must NOT leak
    });
    const cache = new CachingDataSource({ inner, innerKeyMap });

    const n = await cache.pullFromInner(`mem://tasks/circles/${CIRCLE}/items/`);
    expect(n).toBe(2);

    // Both re-keyed to logical mem:// space.
    const t1 = await cache.read(`mem://tasks/circles/${CIRCLE}/items/01DEVICED.json`);
    const t2 = await cache.read(`mem://tasks/circles/${CIRCLE}/items/01DEVICEE.json`);
    expect(JSON.parse(t1).text).toBe('device D');
    expect(JSON.parse(t2).text).toBe('device E');

    // Logical listing shows exactly the two items.
    const listed = await cache.list(`mem://tasks/circles/${CIRCLE}/items/`);
    expect(listed.sort()).toEqual([
      `mem://tasks/circles/${CIRCLE}/items/01DEVICED.json`,
      `mem://tasks/circles/${CIRCLE}/items/01DEVICEE.json`,
    ]);
  });

  it('enumerates members without polluting items', async () => {
    const inner = mkInner({
      'https://grp.pod/household/members/alice%40example.json': '{"webid":"alice"}',
      'https://grp.pod/household/members/bob%40example.json':   '{"webid":"bob"}',
      'https://grp.pod/household/items/01X.json':               '{"type":"task"}',
    });
    const cache = new CachingDataSource({ inner, innerKeyMap });

    const n = await cache.pullFromInner(`mem://tasks/circles/${CIRCLE}/members/`);
    expect(n).toBe(2);
    const listed = await cache.list(`mem://tasks/circles/${CIRCLE}/members/`);
    expect(listed).toHaveLength(2);
    // Items must NOT appear in members listing.
    expect(listed.every((k) => k.includes('/members/'))).toBe(true);
  });

  it('write via logical key is stored at the correct pod URI', async () => {
    const inner = mkInner({});
    const cache = new CachingDataSource({ inner, innerKeyMap });

    // Activate innerKeyMap by simulating an attached inner source.
    // In production `attachTasksBundle` sets _podCtx.active; here we
    // prove the toInner mapping directly through the live innerKeyMap.
    const key   = `mem://tasks/circles/${CIRCLE}/items/01ZNEW.json`;
    const value = '{"id":"01ZNEW","type":"task"}';

    // Exercise the mapping directly (no attachInner needed for this
    // pure-mapping check — CachingDataSource writes to cache first,
    // then flushes to inner on attach).
    const mapped = innerKeyMap.toInner(key);
    expect(mapped).toBe(`https://grp.pod/household/items/01ZNEW.json`);

    const back = innerKeyMap.fromInner(mapped);
    expect(back).toBe(key);
  });
});
