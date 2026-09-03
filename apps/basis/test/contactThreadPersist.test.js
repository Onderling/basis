/**
 * contactThreadChannel — durability (connectivity Phase 2, §5 / C3; the G18 fix).
 *
 * The two 1:1 DM paths are folded into ONE addressed send: `sendTurn` now routes
 * through the shared persisted `deliver`. When an itemStore is wired, a contact
 * DM is BOTH delivered to the peer AND persisted to a durable thread that
 * rehydrates across a "reload" — closing G18 (the contact/bot DM path used to be
 * ephemeral). These tests prove the durability upgrade without changing the wire
 * (the peer still receives the exact legacy `contact-msg` payload).
 */
import { describe, it, expect, vi } from 'vitest';

import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';
import { makePeerRouter } from '../src/core/handlers/peerRouter.js';

/** A minimal itemStore stub matching wireChat's `{ addItems, listOpen }` surface. */
function memItemStore() {
  const items = [];
  return {
    items,
    addItems: vi.fn(async (drafts) => {
      const persisted = drafts.map((d, i) => ({ id: `id-${items.length + i}`, addedAt: Date.now(), ...d }));
      items.push(...persisted);
      return persisted;
    }),
    listOpen: vi.fn(async () => items.slice()),
  };
}

describe('a received file keeps its BYTES out of the snapshot store', () => {
  // Decided 2026-09-03. The three device stores are each ONE serialised value; on Android AsyncStorage that
  // value is a single SQLite row behind a ~2 MB cursor window, and a read failure comes back as an EMPTY
  // map which the next save writes over the row. So a photo persisted inline does not just fail to load —
  // it takes the whole thread store with it. The bytes belong in a per-key blob store; the item keeps the
  // metadata and a pointer.
  it('persists metadata only — the base64 never reaches the item', async () => {
    const store = memItemStore();
    const blobs = new Map();
    const ch = createContactThreadChannel({
      sendToPeer: vi.fn(async () => ({})),
      itemStore: store,
      blobStore: { put: async (id, b64) => { blobs.set(id, b64); }, get: async (id) => blobs.get(id) ?? null },
    });
    const dataB64 = 'A'.repeat(120_000);   // a photo-shaped payload
    await ch.persistInbound({
      contactId: 'peer-A', fromAddr: 'peer-A', text: '', messageId: 'm1', ts: 1,
      file: { id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 90_000, dataB64 },
    });

    const serialised = JSON.stringify(store.addItems.mock.calls);
    expect(serialised.includes(dataB64), 'the snapshot must not carry the bytes').toBe(false);
    expect(serialised.length, 'the persisted draft stays small').toBeLessThan(4_000);
    // …and the metadata survives, so the thread can still render a card
    const draft = store.addItems.mock.calls[0][0][0];
    expect(draft.source.file).toMatchObject({ id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 90_000 });
    expect(draft.source.file.dataB64, 'no bytes on the item').toBeUndefined();
    // the bytes went to the blob store, under the file id
    expect(blobs.get('f1')).toBe(dataB64);
  });

  it('rehydrate puts the bytes back, so the renderer is unchanged', async () => {
    const store = memItemStore();
    const blobs = new Map();
    const blobStore = { put: async (id, b64) => { blobs.set(id, b64); }, get: async (id) => blobs.get(id) ?? null };
    const ch = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: store, blobStore });
    const dataB64 = 'B'.repeat(5_000);
    await ch.persistInbound({
      contactId: 'peer-A', fromAddr: 'peer-A', text: '', messageId: 'm2', ts: 2,
      file: { id: 'f2', name: 'b.jpg', mime: 'image/jpeg', size: 3_000, dataB64 },
    });
    const turns = await ch.rehydrate('peer-A');
    const withFile = turns.find((t) => t.file);
    expect(withFile, 'the turn comes back').toBeTruthy();
    expect(withFile.file.dataB64, 'bytes re-attached on read').toBe(dataB64);
  });

  it('a blob store that loses the bytes still returns the turn, without them', async () => {
    const store = memItemStore();
    const ch = createContactThreadChannel({
      sendToPeer: vi.fn(async () => ({})),
      itemStore: store,
      blobStore: { put: async () => {}, get: async () => null },   // wrote nowhere / evicted
    });
    await ch.persistInbound({
      contactId: 'peer-A', fromAddr: 'peer-A', text: '', messageId: 'm3', ts: 3,
      file: { id: 'f3', name: 'c.jpg', mime: 'image/jpeg', size: 10, dataB64: 'QUJD' },
    });
    const turns = await ch.rehydrate('peer-A');
    const t = turns.find((x) => x.file);
    expect(t.file.name, 'the card still renders its name/size').toBe('c.jpg');
    expect(t.file.dataB64, 'and is honest that the bytes are gone').toBeUndefined();
  });
});

describe('contactThreadChannel — durable DM (G18 fix)', () => {
  it('sendTurn DELIVERS to the peer AND persists the outbound turn', async () => {
    const sent = [];
    const store = memItemStore();
    const ch = createContactThreadChannel({
      sendToPeer: (addr, payload) => { sent.push({ addr, payload }); },
      itemStore: store,
      localActor: 'https://jan.example/me',
      now: () => 1000,
    });

    const { messageId, sent: p } = ch.sendTurn({
      peerAddr: 'bot-addr', threadId: 'contact-7', text: 'de wachtlijst is te lang',
    });
    await p;

    // still delivered, byte-unchanged wire (subtype preserved)
    expect(sent).toHaveLength(1);
    expect(sent[0].addr).toBe('bot-addr');
    expect(sent[0].payload).toMatchObject({
      subtype: 'contact-msg', threadId: 'contact-7', text: 'de wachtlijst is te lang', messageId, ts: 1000,
    });

    // AND persisted as a durable DM item
    expect(store.addItems).toHaveBeenCalledOnce();
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      type: 'chat-message', text: 'de wachtlijst is te lang',
      source: { dm: true, threadKey: 'contact-7', subtype: 'contact-msg', direction: 'out', nonce: messageId },
    });
  });

  it('persists inbound replies too, then rehydrates the FULL ordered thread', async () => {
    const store = memItemStore();
    let clock = 1000;
    const ch = createContactThreadChannel({
      sendToPeer: () => {},
      itemStore: store,
      localActor: 'https://jan.example/me',
      now: () => clock,
    });

    // user turn out
    clock = 1000;
    await ch.sendTurn({ peerAddr: 'bot-addr', threadId: 'contact-7', text: 'hoi', messageId: 'm-out-1' }).sent;
    // bot reply in
    clock = 2000;
    await ch.persistInbound({ contactId: 'contact-7', fromAddr: 'bot-addr', text: 'bedankt!', messageId: 'm-in-1', buttons: [{ id: 'ok', label: 'Ok' }] });
    // second user turn out
    clock = 3000;
    await ch.sendTurn({ peerAddr: 'bot-addr', threadId: 'contact-7', text: 'top', messageId: 'm-out-2' }).sent;

    // "reload": a fresh rehydrate reads the durable thread back, in order
    const turns = await ch.rehydrate('contact-7');
    expect(turns.map((m) => [m.origin, m.text])).toEqual([
      ['user', 'hoi'],
      ['bot', 'bedankt!'],
      ['user', 'top'],
    ]);
    // inbound buttons survive the round-trip
    expect(turns[1].buttons).toEqual([{ id: 'ok', label: 'Ok' }]);
  });

  it('a received FILE rides the turn and rehydrates whole — bytes via the blob store (the peer-wire photo)', async () => {
    // The receive door decided 2026-09-02: a peer-wire file lands in the sender's contact thread, and
    // the thread is the durable home of the received copy — like any messenger keeps a photo in the
    // conversation. Since 2026-09-03 the DESCRIPTION rides the item and the BYTES ride the blob
    // store; the round-trip is still whole, which is what a reader of this thread cares about.
    const store = memItemStore();
    const blobs = new Map();
    const ch = createContactThreadChannel({
      sendToPeer: vi.fn(async () => ({})), itemStore: store,
      blobStore: { put: async (id, b64) => { blobs.set(id, b64); }, get: async (id) => blobs.get(id) ?? null },
    });
    const file = { id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 277431, dataB64: '/9j/4AAQfake' };
    await ch.persistInbound({ contactId: 'peer-addr-1', fromAddr: 'peer-addr-1', text: '', messageId: 'file-share-f1', file });
    await ch.persistInbound({ contactId: 'peer-addr-1', fromAddr: 'peer-addr-1', text: 'mooi he', messageId: 'm-2' });

    const turns = await ch.rehydrate('peer-addr-1');
    expect(turns).toHaveLength(2);
    expect(turns[0].file).toEqual(file);
    expect(turns[0].origin).toBe('bot');
    expect(turns[1].file).toBeUndefined();
    // …and the file-share dedup nonce holds: a relay-replayed share never lands twice.
    await ch.persistInbound({ contactId: 'peer-addr-1', fromAddr: 'peer-addr-1', text: '', messageId: 'file-share-f1', file });
    expect(await ch.rehydrate('peer-addr-1')).toHaveLength(2);
  });

  it('rehydrate isolates by contact (one thread never leaks into another)', async () => {
    const store = memItemStore();
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: store });
    await ch.sendTurn({ peerAddr: 'a', threadId: 'contact-A', text: 'for A', messageId: 'a1' }).sent;
    await ch.sendTurn({ peerAddr: 'b', threadId: 'contact-B', text: 'for B', messageId: 'b1' }).sent;

    expect((await ch.rehydrate('contact-A')).map((m) => m.text)).toEqual(['for A']);
    expect((await ch.rehydrate('contact-B')).map((m) => m.text)).toEqual(['for B']);
  });

  it('shares dedup across out+in so a relay-replayed turn never double-persists', async () => {
    const store = memItemStore();
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: store });

    await ch.persistInbound({ contactId: 'c', fromAddr: 'bot', text: 'once', messageId: 'dup-1' });
    await ch.persistInbound({ contactId: 'c', fromAddr: 'bot', text: 'once', messageId: 'dup-1' });   // replay

    expect(store.items).toHaveLength(1);
    expect((await ch.rehydrate('c')).map((m) => m.text)).toEqual(['once']);
  });

  it('WITHOUT an itemStore stays ephemeral: delivers, persists nothing, rehydrates empty', async () => {
    const sent = [];
    const ch = createContactThreadChannel({ sendToPeer: (a, p) => sent.push({ a, p }) });
    await ch.sendTurn({ peerAddr: 'bot', threadId: 't', text: 'hi', messageId: 'x1' }).sent;
    expect(sent).toHaveLength(1);                       // still delivered
    expect(await ch.rehydrate('t')).toEqual([]);        // nothing durable
  });

  it('an itemStore built ASYNC (a thunk returning a Promise) still persists + rehydrates', async () => {
    const store = memItemStore();
    const ch = createContactThreadChannel({
      sendToPeer: () => {},
      itemStore: () => Promise.resolve(store),          // lazily-resolved store
    });
    await ch.sendTurn({ peerAddr: 'bot', threadId: 't', text: 'lazy', messageId: 'l1' }).sent;
    expect(store.items).toHaveLength(1);
    expect((await ch.rehydrate('t')).map((m) => m.text)).toEqual(['lazy']);
  });

  it('the live inbound render path is unchanged (replyHandler still forwards to onReply)', () => {
    const onReply = vi.fn();
    const store = memItemStore();
    const ch = createContactThreadChannel({ sendToPeer: () => {}, itemStore: store });
    const router = makePeerRouter({ handlers: { [ch.subtypes.in]: ch.replyHandler(onReply) } });
    router({ from: 'bot-addr', payload: { subtype: 'contact-reply', threadId: 'contact-7', text: 'live', messageId: 'r-1' } });
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ fromAddr: 'bot-addr', text: 'live' }));
  });
});
