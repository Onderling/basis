/**
 * A DIRECT MESSAGE IS NOT READABLE IN ITS STORE ON THE WEB OR THE PHONE.
 *
 * The 1:1 threads (the contact-DM store) and the phone's circle lists were built WITHOUT the content seal on web and
 * phone, while the box sealed its copy: a person's direct messages sat in IndexedDB / AsyncStorage as plain text. Both
 * shells now build these stores through `buildShellSealedDataSource`, which waits for the device's content key and
 * seals what reaches the disk. A message written through it is not readable in the raw store.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { flushPendingSaves } from '@onderling/local-store';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';
import { buildShellSealedDataSource } from '../../src/v2/shellSealedDataSource.js';
import { createContactDmStore } from '../../src/v2/contactDmStore.js';

const KEY = 'C'.repeat(43);
const rawIdb = (dbName) => new Promise((resolve, reject) => {
  const req = indexedDB.open(dbName, 1);
  req.onerror = (e) => reject(e.target.error);
  req.onsuccess = (e) => {
    const db = e.target.result;
    const g = db.transaction('items', 'readonly').objectStore('items').get('state');
    g.onsuccess = () => { db.close(); resolve(String(g.result ?? '')); };
    g.onerror = (ev) => reject(ev.target.error);
  };
});
function memoryAsyncStorage() {
  const m = new Map();
  return { m, async getItem(k) { return m.has(k) ? m.get(k) : null; }, async setItem(k, v) { m.set(k, String(v)); }, async removeItem(k) { m.delete(k); } };
}

describe('direct messages and the phone lists, sealed at rest', () => {
  afterEach(() => setShellContentSeal(null));

  it('web: a DM written through the contact-DM store is not readable in IndexedDB', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const dataSource = await buildShellSealedDataSource({ dbName: 'dm-sealed-web', storeName: 'items', saveDelayMs: 5, kind: 'messages' });
    const store = createContactDmStore({ dataSource, localActor: 'me' });
    await store.addItems([{ type: 'message', text: 'geheim bericht voor Anna' }], { conversationId: 'dm:anna' });
    await flushPendingSaves();
    await new Promise((r) => setTimeout(r, 30));
    const raw = await rawIdb('dm-sealed-web');
    expect(raw.length, 'nothing reached the store').toBeGreaterThan(0);
    expect(raw).not.toContain('geheim bericht');
  });

  it('phone: the same through AsyncStorage', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const asyncStorage = memoryAsyncStorage();
    const dataSource = await buildShellSealedDataSource({ dbName: 'basis.contact-dm-state', asyncStorage, saveDelayMs: 5, kind: 'messages' });
    const store = createContactDmStore({ dataSource, localActor: 'me' });
    await store.addItems([{ type: 'message', text: 'geheim bericht voor Bas' }], { conversationId: 'dm:bas' });
    await flushPendingSaves();
    await new Promise((r) => setTimeout(r, 30));
    const all = [...asyncStorage.m.values()].join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain('geheim bericht');
  });

  it('built before the key, it waits for it (never plain for the session)', async () => {
    const asyncStorage = memoryAsyncStorage();
    const pending = buildShellSealedDataSource({ dbName: 'basis.circle-lists-state', asyncStorage, saveDelayMs: 5, kind: 'lists' });
    let built = false;
    pending.then(() => { built = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(built, 'built before the key: it would write plain').toBe(false);
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const ds = await pending;
    await ds.write('mem://lists/items/x', JSON.stringify({ title: 'melk en eieren' }));
    await flushPendingSaves();
    await new Promise((r) => setTimeout(r, 30));
    expect([...asyncStorage.m.values()].join('\n')).not.toContain('melk en eieren');
  });
});
