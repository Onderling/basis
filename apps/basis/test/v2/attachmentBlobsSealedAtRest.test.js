/**
 * A RECEIVED FILE IS NOT READABLE IN ITS STORE ON THE WEB OR THE PHONE.
 *
 * A file a contact sends (a photo in a 1:1 thread) keeps its bytes outside the thread's snapshot: in IndexedDB on the
 * web, as a file on the phone. Both were written as the plain base64 of the file, while the thread beside them is
 * sealed. `sealedBlobStore` wraps either store so what reaches the disk is sealed with the device's content key.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';
import { createAttachmentBlobStore, sealedBlobStore } from '../../src/v2/attachmentBlobStore.js';
import { storageName } from '../../src/v2/storageRegister.js';

const KEY = 'D'.repeat(43);
const PHOTO = Buffer.from('een foto van Anna haar fiets').toString('base64');

const rawIdb = (id) => new Promise((resolve, reject) => {
  const req = indexedDB.open(storageName('attachmentBlobs'), 1);
  req.onerror = (e) => reject(e.target.error);
  req.onsuccess = (e) => {
    const db = e.target.result;
    const g = db.transaction('blobs', 'readonly').objectStore('blobs').get(id);
    g.onsuccess = () => { db.close(); resolve(g.result == null ? null : String(g.result)); };
    g.onerror = (ev) => reject(ev.target.error);
  };
});

/** The phone's store has the same two methods over files; a map stands in for the directory. */
function memoryBlobs() {
  const m = new Map();
  return { m, async put(id, v) { m.set(id, v); }, async get(id) { return m.has(id) ? m.get(id) : null; } };
}

describe('received files, sealed at rest', () => {
  afterEach(() => setShellContentSeal(null));

  it('web: the bytes in IndexedDB are not the file, and read back as the file', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const blobs = sealedBlobStore(createAttachmentBlobStore());
    await blobs.put('f1', PHOTO);
    const raw = await rawIdb('f1');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(PHOTO);
    expect(await blobs.get('f1')).toBe(PHOTO);
  });

  it('phone: the file written is not the file, and reads back as the file', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const inner = memoryBlobs();
    const blobs = sealedBlobStore(inner);
    await blobs.put('f2', PHOTO);
    expect(inner.m.get('f2')).not.toContain(PHOTO);
    expect(await blobs.get('f2')).toBe(PHOTO);
  });

  it('a put before the content key waits for it: nothing is written plain', async () => {
    const inner = memoryBlobs();
    const blobs = sealedBlobStore(inner);
    const done = blobs.put('f3', PHOTO);
    await new Promise((r) => setTimeout(r, 5));
    expect(inner.m.has('f3')).toBe(false);
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    await done;
    expect(inner.m.get('f3')).not.toContain(PHOTO);
    expect(await blobs.get('f3')).toBe(PHOTO);
  });

  it('a stored file sealed under another key reads as missing, never as its sealed text', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const inner = memoryBlobs();
    await sealedBlobStore(inner).put('f4', PHOTO);
    setShellContentSeal(groupKeyStrategy({ groupKey: 'E'.repeat(43) }));
    expect(await sealedBlobStore(inner).get('f4')).toBeNull();
  });
});
