/**
 * CachingDataSource — focused substrate test for the Phase 1
 * `innerKeyMap` seam (logical-key ↔ inner-URI translation at the
 * `#inner` boundary). Stoop's apps/stoop/test/phase{4,33,34}.js +
 * tasks-v0 exercise the broader behaviour end-to-end; this file
 * pins the new seam + its behaviour-neutral identity default.
 */

import { describe, it, expect } from 'vitest';
import { CachingDataSource } from '../src/CachingDataSource.js';

function mkInner() {
  const map = new Map();
  return {
    map,
    async write(u, d) { map.set(u, d); },
    async delete(u)   { map.delete(u); },
    async read(u)     { return map.has(u) ? map.get(u) : null; },
    async list(p)     { return [...map.keys()].filter((k) => k.startsWith(p)); },
  };
}

// A representative mem://→pod mapper (mirrors the Phase 1 intent).
const podMap = {
  toInner: (p) =>
    p.startsWith('mem://neighbourhood/')
      ? p.replace('mem://neighbourhood/', 'https://pod/sharing/')
      : p.replace('mem://', 'https://pod/'),
  fromInner: (u) =>
    u.startsWith('https://pod/sharing/')
      ? u.replace('https://pod/sharing/', 'mem://neighbourhood/')
      : u.replace('https://pod/', 'mem://'),
};

describe('CachingDataSource — innerKeyMap seam', () => {
  it('identity default: inner receives the exact logical keys (behaviour-neutral)', async () => {
    const inner = mkInner();
    const c = new CachingDataSource({ inner });
    await c.write('mem://neighbourhood/items/1.json', 'A');
    expect(inner.map.get('mem://neighbourhood/items/1.json')).toBe('A');
    await c.delete('mem://neighbourhood/items/1.json');
    expect(inner.map.has('mem://neighbourhood/items/1.json')).toBe(false);

    const inner2 = mkInner();
    inner2.map.set('mem://x', 'V');
    const c2 = new CachingDataSource({ inner: inner2 });
    expect(await c2.read('mem://x')).toBe('V');
  });

  it('with a mapper: translates ONLY at the #inner boundary; cache/queue stay logical', async () => {
    const inner = mkInner();
    const c = new CachingDataSource({ inner, innerKeyMap: podMap });

    await c.write('mem://neighbourhood/items/1.json', 'A');
    // inner got the MAPPED uri, never the logical key
    expect(inner.map.get('https://pod/sharing/items/1.json')).toBe('A');
    expect(inner.map.has('mem://neighbourhood/items/1.json')).toBe(false);
    // local cache stays keyed by the logical key
    expect(await c.list('mem://')).toContain('mem://neighbourhood/items/1.json');

    await c.delete('mem://neighbourhood/items/1.json');
    expect(inner.map.has('https://pod/sharing/items/1.json')).toBe(false);
  });

  it('pullFromInner maps inner→logical so the local cache is keyed logically', async () => {
    const inner = mkInner();
    inner.map.set('https://pod/sharing/items/9.json', 'Z');
    const c = new CachingDataSource({ inner, innerKeyMap: podMap });

    const n = await c.pullFromInner('mem://neighbourhood/');
    expect(n).toBe(1);
    // read hits the local cache under the LOGICAL key
    expect(await c.read('mem://neighbourhood/items/9.json')).toBe('Z');
  });

  it('read miss maps the logical key to the inner URI', async () => {
    const inner = mkInner();
    inner.map.set('https://pod/sharing/items/7.json', 'Q');
    const c = new CachingDataSource({ inner, innerKeyMap: podMap });
    expect(await c.read('mem://neighbourhood/items/7.json')).toBe('Q');
  });

  it('an invalid innerKeyMap falls back to identity (no throw)', async () => {
    const inner = mkInner();
    const c = new CachingDataSource({ inner, innerKeyMap: { toInner: 'nope' } });
    await c.write('k', 'v');
    expect(inner.map.get('k')).toBe('v');
  });
});
