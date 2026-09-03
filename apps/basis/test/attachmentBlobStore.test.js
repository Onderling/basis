/**
 * The attachment blob store (web) — bytes live here so they never enter a snapshot.
 * A fake IndexedDB keeps the test honest about the contract without a browser.
 */
import { describe, it, expect } from 'vitest';
import { createAttachmentBlobStore } from '../src/v2/attachmentBlobStore.js';

/** The thinnest IDBFactory that satisfies open/put/get, plus a switch to make it fail. */
function fakeIndexedDB({ failOpen = false } = {}) {
  const data = new Map();
  const later = (obj, ok, val) => { setTimeout(() => { if (ok) { obj.result = val; obj.onsuccess?.(); } else { obj.error = new Error('boom'); obj.onerror?.(); } }, 0); return obj; };
  return {
    data,
    open() {
      const req = {};
      if (failOpen) return later(req, false);
      const db = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            put: (v, k) => later({}, true, (data.set(k, v), undefined)),
            get: (k) => later({}, true, data.get(k) ?? null),
          }),
        }),
      };
      return later(req, true, db);
    },
  };
}

describe('createAttachmentBlobStore', () => {
  it('round-trips a payload under the file id', async () => {
    const idb = fakeIndexedDB();
    const s = createAttachmentBlobStore({ indexedDB: idb });
    await s.put('f1', 'QUJD');
    expect(await s.get('f1')).toBe('QUJD');
    expect(idb.data.get('f1'), 'stored under its own key, not in any snapshot').toBe('QUJD');
  });

  it('a missing id reads back null rather than throwing', async () => {
    const s = createAttachmentBlobStore({ indexedDB: fakeIndexedDB() });
    expect(await s.get('nope')).toBeNull();
  });

  it('with no IndexedDB at all it degrades quietly — put is a no-op, get is null', async () => {
    const s = createAttachmentBlobStore({ indexedDB: undefined });
    await s.put('f1', 'QUJD');
    expect(await s.get('f1')).toBeNull();
  });

  it('a failing store never throws at the caller (the turn must still land)', async () => {
    const s = createAttachmentBlobStore({ indexedDB: fakeIndexedDB({ failOpen: true }) });
    await expect(s.put('f1', 'QUJD')).resolves.toBeUndefined();
    expect(await s.get('f1')).toBeNull();
  });

  it('ignores an empty payload — nothing to store, nothing written', async () => {
    const idb = fakeIndexedDB();
    const s = createAttachmentBlobStore({ indexedDB: idb });
    await s.put('f1', '');
    expect(idb.data.size).toBe(0);
  });
});
