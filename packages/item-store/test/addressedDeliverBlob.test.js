/**
 * The seam's own contract: a persisted turn carries a file's DESCRIPTION, never its bytes.
 *
 * This store is serialised as ONE value per device. A payload inside that value is what makes a whole
 * thread unreadable on a device with a per-row read ceiling — and worse, silently, because the failing
 * read returns an empty map that the next save writes back. So the rule belongs here, at the door every
 * caller goes through, not in whichever app happened to remember it.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAddressedDeliver, chatTurnsFromItems } from '../src/addressedDeliver.js';

function memStore() {
  const items = [];
  return {
    items,
    addItems: vi.fn(async (drafts) => {
      const out = drafts.map((d, i) => ({ id: `id-${items.length + i}`, addedAt: 1, ...d }));
      items.push(...out); return out;
    }),
    listOpen: vi.fn(async () => items.slice()),
  };
}
const fileWith = (dataB64) => ({ id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 9, dataB64 });

describe('createAddressedDeliver — bytes never enter the item', () => {
  it('strips the payload into the blob store and keeps the description on the item', async () => {
    const store = memStore(); const blobs = new Map();
    const d = createAddressedDeliver({
      send: vi.fn(), itemStore: store,
      blobStore: { put: async (id, b) => { blobs.set(id, b); }, get: async (id) => blobs.get(id) ?? null },
    });
    const payload = 'Z'.repeat(50_000);
    await d.persistInbound({ id: 'm1', ts: 1, extras: { file: fileWith(payload) } }, { to: 'peer-A' });

    expect(JSON.stringify(store.items).includes(payload), 'no payload anywhere in the store').toBe(false);
    expect(store.items[0].source.file).toEqual({ id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 9 });
    expect(blobs.get('f1')).toBe(payload);
  });

  it('WITHOUT a blob store the bytes are dropped, not inlined — inline is the failure being prevented', async () => {
    const store = memStore();
    const d = createAddressedDeliver({ send: vi.fn(), itemStore: store });
    await d.persistInbound({ id: 'm1', ts: 1, extras: { file: fileWith('QUJD') } }, { to: 'peer-A' });
    expect(store.items[0].source.file.dataB64).toBeUndefined();
    expect(JSON.stringify(store.items).includes('QUJD')).toBe(false);
  });

  it('attachBytes restores the payload on read, so renderers are unchanged', async () => {
    const store = memStore(); const blobs = new Map([['f1', 'QUJD']]);
    const d = createAddressedDeliver({
      send: vi.fn(), itemStore: store,
      blobStore: { put: async () => {}, get: async (id) => blobs.get(id) ?? null },
    });
    await d.persistInbound({ id: 'm1', ts: 1, extras: { file: fileWith('QUJD') } }, { to: 'peer-A' });
    const turns = await d.attachBytes(chatTurnsFromItems(store.items, { threadKey: 'peer-A' }));
    expect(turns[0].file.dataB64).toBe('QUJD');
  });

  it('a blob store that throws never costs the turn', async () => {
    const store = memStore();
    const d = createAddressedDeliver({
      send: vi.fn(), itemStore: store,
      blobStore: { put: async () => { throw new Error('disk full'); }, get: async () => { throw new Error('gone'); } },
    });
    await d.persistInbound({ id: 'm1', ts: 1, extras: { file: fileWith('QUJD') } }, { to: 'peer-A' });
    expect(store.items).toHaveLength(1);                       // the message survived
    const turns = await d.attachBytes(chatTurnsFromItems(store.items, { threadKey: 'peer-A' }));
    expect(turns[0].file.name).toBe('foto.jpg');               // the card still renders
    expect(turns[0].file.dataB64).toBeUndefined();             // and is honest about the bytes
  });

  it('a turn with no file is untouched', async () => {
    const store = memStore();
    const d = createAddressedDeliver({ send: vi.fn(), itemStore: store, blobStore: { put: async () => {}, get: async () => null } });
    await d.persistInbound({ id: 'm1', ts: 1, body: 'hoi' }, { to: 'peer-A' });
    expect(store.items[0].source.file).toBeUndefined();
  });
});
