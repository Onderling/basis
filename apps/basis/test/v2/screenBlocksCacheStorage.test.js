/**
 * basis v2 — δ.1 localStorage adapter tests for the screen-blocks cache.
 *
 * Verifies the wire-level keys (`cc.screenBlocksCache.<screenId>`), JSON
 * round-trip, and the missing-key / clear semantics.  Uses a vi-mock
 * `storage` rather than jsdom so the test is fast + node-portable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal, openStoredValue } from '../../src/v2/localStoreSeal.js';
import {
  localStorageScreenBlocksCacheIo,
  createScreenBlocksCacheLocal,
} from '../../src/v2/screenBlocksCacheStorage.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _backing: m,
  };
}

// the cache seals its values (ledger L1081): these tests run with a content key published, as after a boot
const seal = groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(8)).toString('base64url') });
beforeEach(() => setShellContentSeal(seal));
afterEach(() => setShellContentSeal(null));

describe('localStorageScreenBlocksCacheIo · δ.1', () => {
  it('writes to cc.screenBlocksCache.<id>, sealed (the JSON opens with the content key)', async () => {
    const s = memStorage();
    const io = localStorageScreenBlocksCacheIo(s);
    const blocks = [{ blockId: 'b1', type: 'noticeboard', status: 'ok' }];
    await io.save('s1', blocks);
    expect(openStoredValue(seal, 'cc.screenBlocksCache.s1', s._backing.get('cc.screenBlocksCache.s1'))).toBe(JSON.stringify(blocks));
  });

  it('reads back the same shape', async () => {
    const s = memStorage();
    const io = localStorageScreenBlocksCacheIo(s);
    const blocks = [{ blockId: 'b', type: 'tasks', status: 'ok', content: { items: [] } }];
    await io.save('s2', blocks);
    expect(await io.load('s2')).toEqual(blocks);
  });

  it('returns null when the key is missing', async () => {
    const io = localStorageScreenBlocksCacheIo(memStorage());
    expect(await io.load('nope')).toBeNull();
  });

  it('returns null when stored JSON is corrupt', async () => {
    const s = memStorage();
    s.setItem('cc.screenBlocksCache.s3', 'not json');
    const io = localStorageScreenBlocksCacheIo(s);
    expect(await io.load('s3')).toBeNull();
  });

  it('remove deletes the slot', async () => {
    const s = memStorage();
    const io = localStorageScreenBlocksCacheIo(s);
    await io.save('s4', [{ blockId: 'b' }]);
    await io.remove('s4');
    expect(s._backing.has('cc.screenBlocksCache.s4')).toBe(false);
    expect(await io.load('s4')).toBeNull();
  });

  it('factory createScreenBlocksCacheLocal binds localStorage IO', async () => {
    const s = memStorage();
    const store = createScreenBlocksCacheLocal(s);
    const blocks = [{ blockId: 'b5', type: 'text', status: 'ok' }];
    await store.set('s5', blocks);
    expect(await store.get('s5')).toEqual(blocks);
    await store.clear('s5');
    expect(await store.get('s5')).toBeNull();
  });
});
