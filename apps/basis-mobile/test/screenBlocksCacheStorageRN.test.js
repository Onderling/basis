/**
 * basis-mobile · δ.1 — AsyncStorage adapter round-trip for the
 * screen-blocks cache.
 *
 * Mirrors `apps/basis/test/v2/screenBlocksCacheStorage.test.js` so
 * the wire-level key shape (`cc.screenBlocksCache.<screenId>`) is
 * identical on both surfaces.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal, openStoredValue } from '../../basis/src/v2/localStoreSeal.js';
import {
  asyncStorageScreenBlocksCacheIo,
  makeScreenBlocksCacheRN,
} from '../src/core/screenBlocksCacheStorageRN.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

describe('δ.1 — screenBlocksCacheStorageRN', () => {
  let storage;
  // the cache seals its values (ledger L1081): these tests run with a content key published, as after a boot
  const seal = groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(8)).toString('base64url') });
  beforeEach(() => { storage = mockAsyncStorage(); setShellContentSeal(seal); });
  afterEach(() => setShellContentSeal(null));

  it('round-trips blocks through save / load', async () => {
    const io = asyncStorageScreenBlocksCacheIo(storage);
    const blocks = [{ blockId: 'b1', type: 'noticeboard', status: 'ok' }];
    await io.save('s1', blocks);
    expect(openStoredValue(seal, 'cc.screenBlocksCache.s1', storage.map.get('cc.screenBlocksCache.s1'))).toBe(JSON.stringify(blocks));
    expect(await io.load('s1')).toEqual(blocks);
  });

  it('returns null when no entry', async () => {
    const io = asyncStorageScreenBlocksCacheIo(storage);
    expect(await io.load('missing')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    await storage.setItem('cc.screenBlocksCache.s2', 'not json');
    const io = asyncStorageScreenBlocksCacheIo(storage);
    expect(await io.load('s2')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const io = asyncStorageScreenBlocksCacheIo(storage);
    await io.save('s3', [{ blockId: 'b' }]);
    await io.remove('s3');
    expect(storage.map.has('cc.screenBlocksCache.s3')).toBe(false);
    expect(await io.load('s3')).toBeNull();
  });

  it('factory makeScreenBlocksCacheRN binds AsyncStorage IO', async () => {
    const store = makeScreenBlocksCacheRN(storage);
    const blocks = [{ blockId: 'b4', type: 'tasks', status: 'ok' }];
    await store.set('s4', blocks);
    expect(await store.get('s4')).toEqual(blocks);
    await store.clear('s4');
    expect(await store.get('s4')).toBeNull();
  });
});
