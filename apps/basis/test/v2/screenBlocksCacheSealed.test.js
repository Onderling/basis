/**
 * A page's kept blocks are sealed at rest (ledger L1081). The screen-blocks cache keeps the last painted blocks of a
 * page — appointment titles, task texts, circle names, the last chat line per circle — so a page opens at once. It
 * wrote them as plain JSON into localStorage (web) and AsyncStorage (phone), next to stores that all seal. Now its
 * values go through `sealedKeyValue`: sealed with the device's content key, keys legible, a write before the key exists
 * refused, an old plain value read once and sealed at the next write.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';
import { createScreenBlocksCacheLocal } from '../../src/v2/screenBlocksCacheStorage.js';
import { makeScreenBlocksCacheRN } from '../../../basis-mobile/src/core/screenBlocksCacheStorageRN.js';
import { forgetThrowawaySelf } from '../../src/v2/enrolForgets.js';

const KEY = Buffer.from(new Uint8Array(32).fill(5)).toString('base64url');
const BLOCKS = [{ blockId: 'agenda', type: 'items', status: 'ok', content: { items: [{ title: 'Tandarts Henk, dinsdag 10:00' }] } }];

function memStorage({ async = false } = {}) {
  const m = new Map();
  const wrap = (v) => (async ? Promise.resolve(v) : v);
  return {
    getItem: (k) => wrap(m.has(k) ? m.get(k) : null),
    setItem: (k, v) => wrap(void m.set(k, String(v))),
    removeItem: (k) => wrap(void m.delete(k)),
    _backing: m,
  };
}

afterEach(() => setShellContentSeal(null));

const shells = [
  ['web (localStorage)', () => { const s = memStorage(); return { s, cache: createScreenBlocksCacheLocal(s) }; }],
  ['phone (AsyncStorage)', () => { const s = memStorage({ async: true }); return { s, cache: makeScreenBlocksCacheRN(s) }; }],
];

describe.each(shells)('the page blocks cache on the %s', (_name, make) => {
  it('what lands in storage is not readable JSON, and it opens with the key', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const { s, cache } = make();
    await cache.set('home', BLOCKS);
    const raw = s._backing.get('basis.screenBlocksCache.home');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('Tandarts');
    expect(() => JSON.parse(raw)).toThrow();
    expect(await cache.get('home')).toEqual(BLOCKS);
  });

  it('before the content key is published: a write is refused (nothing stored), a read is "no cache"; after it, both work', async () => {
    const { s, cache } = make();
    await cache.set('home', BLOCKS);
    expect(s._backing.has('basis.screenBlocksCache.home')).toBe(false);
    // a value sealed earlier, read before this start's key exists: no cache — never sealed text handed on, never a throw
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    await cache.set('home', BLOCKS);
    setShellContentSeal(null);
    expect(await cache.get('home')).toBeNull();
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    expect(await cache.get('home')).toEqual(BLOCKS);
  });

  it('an old plain value is read once and sealed at the next write', async () => {
    const { s, cache } = make();
    s._backing.set('basis.screenBlocksCache.home', JSON.stringify(BLOCKS));
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    expect(await cache.get('home')).toEqual(BLOCKS);
    await cache.set('home', BLOCKS);
    expect(s._backing.get('basis.screenBlocksCache.home')).not.toContain('Tandarts');
  });
});

describe('forgetting after an enrol still removes the sealed blocks', () => {
  it('the forget after an enrol drops the sealed values by their prefix', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const s = memStorage();
    const cache = createScreenBlocksCacheLocal(s);
    await cache.set('home', BLOCKS);
    await cache.set('agenda', BLOCKS);
    expect([...s._backing.keys()].filter((k) => k.startsWith('basis.screenBlocksCache.'))).toHaveLength(2);
    const r = await forgetThrowawaySelf({ listCircleIds: () => [], listKeys: () => [...s._backing.keys()], dropStore: () => {}, dropKey: (k) => s.removeItem(k) });
    expect(r.ok).toBe(true);
    expect([...s._backing.keys()].filter((k) => k.startsWith('basis.screenBlocksCache.'))).toEqual([]);
  });
});
