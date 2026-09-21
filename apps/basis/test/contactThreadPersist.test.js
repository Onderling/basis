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

describe('persistOutbound — our side of a reply that went out by another path', () => {
  // A reply to a noticeboard post travels through the chat op, not through `sendTurn`; the poster's
  // thread still has to show it, marked with the post it answers (decided 2026-09-03).
  it('persists an outbound turn (no send) that rehydrates as OUR turn with its replyTo', async () => {
    const store = memItemStore();
    const sendToPeer = vi.fn(async () => ({}));
    const ch = createContactThreadChannel({ sendToPeer, itemStore: store, localActor: 'me' });
    const r = await ch.persistOutbound({ contactId: 'poster-A', peerAddr: 'poster-A', text: 'ik kan helpen', replyTo: 'post-1', messageId: 'post-reply-1' });
    expect(r.itemId).toBeTruthy();
    expect(sendToPeer).not.toHaveBeenCalled();
    const turns = await ch.rehydrate('poster-A');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ origin: 'user', text: 'ik kan helpen', replyTo: 'post-1', messageId: 'post-reply-1' });
    // dedup on the message id — a second persist of the same reply is a no-op
    const again = await ch.persistOutbound({ contactId: 'poster-A', peerAddr: 'poster-A', text: 'ik kan helpen', replyTo: 'post-1', messageId: 'post-reply-1' });
    expect(again.deduped).toBe(true);
    expect(await ch.rehydrate('poster-A')).toHaveLength(1);
  });
});

describe('this device\'s selection (sync-policy §11): hold nothing still carry; the bytes as chosen', () => {
  const rig = (selection) => {
    const store = memItemStore();
    const blobs = new Map();
    const fanned = [];
    const ch = createContactThreadChannel({
      sendToPeer: vi.fn(async () => ({})),
      itemStore: store,
      blobStore: { put: async (id, b64) => { blobs.set(id, b64); }, get: async (id) => blobs.get(id) ?? null },
      fanToOwnDevices: async (turn) => { fanned.push(turn); },
      selection,
    });
    return { ch, store, blobs, fanned };
  };
  const file = { id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 3, dataB64: 'YWJj' };

  it('contacts OFF: a received turn is stored NOWHERE and still fanned to the siblings — bytes included', async () => {
    const { ch, store, blobs, fanned } = rig({ holds: (silo) => silo !== 'contacts', keepsBytes: () => true });
    const res = await ch.persistInbound({ contactId: 'peer-A', fromAddr: 'peer-A', text: 'hoi', messageId: 'm1', ts: 1, file });
    expect(res.itemId).toBe(null);
    expect(store.addItems).not.toHaveBeenCalled();
    expect(blobs.size).toBe(0);
    expect(fanned).toHaveLength(1);
    expect(fanned[0].file.dataB64, 'the carry forwards the bytes').toBe('YWJj');
    // an outbound turn is not kept either
    await ch.persistOutbound({ contactId: 'peer-A', peerAddr: 'peer-A', text: 'dag', messageId: 'm2', ts: 2 });
    expect(store.addItems).not.toHaveBeenCalled();
    expect(fanned).toHaveLength(2);
  });
  it('bytes = description: the turn is kept, the file without its bytes; the fan still carries them whole', async () => {
    const { ch, store, blobs, fanned } = rig({ holds: () => true, keepsBytes: () => false });
    await ch.persistInbound({ contactId: 'peer-A', fromAddr: 'peer-A', text: '', messageId: 'm1', ts: 1, file });
    expect(store.addItems).toHaveBeenCalledTimes(1);
    expect(store.addItems.mock.calls[0][0][0].source.file).toMatchObject({ id: 'f1', name: 'foto.jpg' });
    expect(blobs.size, 'no bytes kept on this device').toBe(0);
    expect(fanned[0].file.dataB64).toBe('YWJj');
  });
  it('a turn that arrived FROM a sibling is stored per this device\'s choice and never fanned back', async () => {
    const { ch, store, blobs, fanned } = rig({ holds: () => true, keepsBytes: () => true });
    await ch.applyOwnDeviceTurn({ direction: 'in', contactId: 'peer-A', fromAddr: 'peer-A', text: '', messageId: 'm1', ts: 1, file });
    expect(store.addItems).toHaveBeenCalledTimes(1);
    expect(blobs.get('f1')).toBe('YWJj');
    expect(fanned).toHaveLength(0);
  });
});

describe('a turn CARRIED by my own device from someone this device never met', () => {
  // The alpha's feedback path, 2026-09-18: a fresh install wrote to the seeded contact; the box (the primary
  // device) took it and carried it to the maker's web app, whose log said "delivered". The web app stored the
  // turn — and showed nothing: Contacten lists the peer graph and the book, the direct-DM handlers put a new
  // sender in the graph (`notePeer`), the carried path did not. A thread nobody can open is a message nobody
  // reads. The channel now tells the shell about the sender the same way on both paths.
  it('makes the sender a contact row — notePeer is called, once, with the sender\'s address', async () => {
    const noted = [];
    const ch = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore(), notePeer: (addr) => { noted.push(addr); } });
    const landed = await ch.applyOwnDeviceTurn({ direction: 'in', contactId: 'visitor-K', fromAddr: 'visitor-K', text: 'hoi Wilfred', messageId: 'c1', ts: 1 });
    expect(landed.deduped).toBe(false);
    expect(noted, 'the carried sender becomes a contact row').toEqual(['visitor-K']);
    // The same turn carried twice (two sibling devices fanned it) notes the sender once.
    const again = await ch.applyOwnDeviceTurn({ direction: 'in', contactId: 'visitor-K', fromAddr: 'visitor-K', text: 'hoi Wilfred', messageId: 'c1', ts: 1 });
    expect(again.deduped).toBe(true);
    expect(noted).toEqual(['visitor-K']);
    // My own outbound turn carried from another of my devices notes nobody: the contact is already mine.
    await ch.applyOwnDeviceTurn({ direction: 'out', contactId: 'friend-F', peerAddr: 'friend-F', text: 'dag', messageId: 'o1', ts: 2 });
    expect(noted).toEqual(['visitor-K']);
  });

  it('a directly received turn notes the sender through the same seam', async () => {
    const noted = [];
    const ch = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore(), notePeer: (addr) => { noted.push(addr); } });
    await ch.persistInbound({ contactId: 'peer-B', fromAddr: 'peer-B', text: 'hallo', messageId: 'd1', ts: 3 });
    expect(noted).toEqual(['peer-B']);
  });
});

describe('a carried turn lands in the thread THIS device keys by identity', () => {
  // Two devices of one person may key the same contact differently: the box keyed the visitor's thread by the
  // wire address the message came from (the visitor's person-key address), the web app keys threads by
  // identity (the visitor's profile address) — Frits' rule of 2026-09-03. The carried turn then landed on
  // the web app under a key its Contacten row never opens (2026-09-19, the browser walk of the feedback
  // path: "maker was handed contactId 58gT…, the row is 8Zcy…"). On landing, the channel resolves the
  // sibling's key through the shell's `identityOf`, so every device of the person opens the same thread.
  it('resolves the sibling\'s contactId through identityOf; notes the resolved person; rehydrates under it', async () => {
    const noted = [];
    const identityOf = (a) => (a === 'visitor-person-key-addr' ? 'visitor-profile' : a);
    const ch = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore(), notePeer: (a) => { noted.push(a); }, identityOf });
    const landed = await ch.applyOwnDeviceTurn({ direction: 'in', contactId: 'visitor-person-key-addr', fromAddr: 'visitor-person-key-addr', text: 'hoi Wilfred', messageId: 'k1', ts: 1 });
    expect(landed.contactId, 'the landed turn names the identity-keyed thread').toBe('visitor-profile');
    expect((await ch.rehydrate('visitor-profile')).map((t) => t.text)).toEqual(['hoi Wilfred']);
    expect(noted).toEqual(['visitor-profile']);
  });
});

describe('a hidden contact who writes again comes back (L106) — one seam, both paths', () => {
  // Frits, 2026-09-19: hidden, not blocked — "requiring the other person to text you again to become activated
  // again". The channel does not know the book; the shell hands in `isHidden(contactId)` and `onReturned(contactId)`.
  // A turn that LANDS from a hidden contact — directly or carried by my own device — fires onReturned once; the
  // shell unhides the row, paints the thread and its one-line marker. A visible contact fires nothing.
  it('fires onReturned once for a hidden sender on the direct path', async () => {
    const returned = [];
    const hidden = new Set(['bob']);
    const ch = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore(), isHidden: (id) => hidden.has(id), onReturned: (id) => { returned.push(id); hidden.delete(id); } });
    await ch.persistInbound({ contactId: 'bob', fromAddr: 'bob', text: 'hoi', messageId: 'r1', ts: 1 });
    expect(returned).toEqual(['bob']);
    await ch.persistInbound({ contactId: 'bob', fromAddr: 'bob', text: 'nog eens', messageId: 'r2', ts: 2 });
    expect(returned, 'shown now — a second message does not fire again').toEqual(['bob']);
    await ch.persistInbound({ contactId: 'carl', fromAddr: 'carl', text: 'dag', messageId: 'r3', ts: 3 });
    expect(returned, 'a visible contact fires nothing').toEqual(['bob']);
  });
  it('fires onReturned for a hidden sender on the CARRIED path, keyed by the identity the shell resolves', async () => {
    const returned = [];
    const hidden = new Set(['bob-profile']);
    const identityOf = (a) => (a === 'bob-person-key' ? 'bob-profile' : a);
    const ch = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore(), identityOf, isHidden: (id) => hidden.has(id), onReturned: (id) => { returned.push(id); hidden.delete(id); } });
    await ch.applyOwnDeviceTurn({ direction: 'in', contactId: 'bob-person-key', fromAddr: 'bob-person-key', text: 'hoi', messageId: 'c1', ts: 1 });
    expect(returned).toEqual(['bob-profile']);
    // The same turn carried again (a second sibling) is deduped and fires nothing.
    await ch.applyOwnDeviceTurn({ direction: 'in', contactId: 'bob-person-key', fromAddr: 'bob-person-key', text: 'hoi', messageId: 'c1', ts: 1 });
    expect(returned).toEqual(['bob-profile']);
    // My own outbound turn to a hidden contact (I wrote to them from another device) does not bring them back —
    // only THEIR message does; writing to someone you hid is your own act, and Tonen is the word for it.
    hidden.add('dave');
    await ch.applyOwnDeviceTurn({ direction: 'out', contactId: 'dave', peerAddr: 'dave', text: 'hey', messageId: 'o1', ts: 2 });
    expect(returned).toEqual(['bob-profile']);
  });
  it('the turn that brought them back is MARKED — stored, fanned, rehydrated — so every device paints the marker above it', async () => {
    // Measured 2026-09-19 on three devices: the box (primary) unhid the row and fanned the mark; the laptop's row
    // was shown before the carried turn arrived, so "is hidden?" said no there and the marker never painted. The
    // fact belongs to the TURN, decided where it first lands, and rides with it.
    const fanned = [];
    const hidden = new Set(['bob']);
    const ch = createContactThreadChannel({
      sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore(),
      isHidden: (id) => hidden.has(id), onReturned: (id) => { hidden.delete(id); },
      fanToOwnDevices: async (turn) => { fanned.push(turn); },
    });
    const res = await ch.persistInbound({ contactId: 'bob', fromAddr: 'bob', text: 'ben ik er nog?', messageId: 'r1', ts: 1 });
    expect(res.returned).toBe(true);
    expect(fanned[0]).toMatchObject({ direction: 'in', contactId: 'bob', messageId: 'r1', returned: true });
    const later = await ch.persistInbound({ contactId: 'bob', fromAddr: 'bob', text: 'en nu?', messageId: 'r2', ts: 2 });
    expect(later.returned, 'a message from a shown contact is not a return').toBeUndefined();
    expect(fanned[1].returned).toBeUndefined();
    const turns = await ch.rehydrate('bob');
    expect(turns.map((t) => [t.messageId, t.returned === true])).toEqual([['r1', true], ['r2', false]]);

    // The SIBLING side: the carried turn says `returned`, the row there is ALREADY shown (the mark got there
    // first) — the landing still reports the return so the shell paints the marker, and still tells the shell
    // (the roster repaints); a carried turn without the mark on a shown row says nothing.
    const sibReturned = [];
    const sib = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore(), isHidden: () => false, onReturned: (id) => { sibReturned.push(id); } });
    const landed = await sib.applyOwnDeviceTurn(fanned[0]);
    expect(landed.returned).toBe(true);
    expect(sibReturned).toEqual(['bob']);
    const plain = await sib.applyOwnDeviceTurn(fanned[1]);
    expect(plain.returned).toBeUndefined();
    expect(sibReturned).toEqual(['bob']);
    expect((await sib.rehydrate('bob')).find((t) => t.messageId === 'r1')?.returned, 'the sibling stores the mark too').toBe(true);
  });
});

describe('the first message carries my card, and a card that arrives names the sender (2026-09-21)', () => {
  // Frits, 09-18: "the device should send a Hi, then they exchange their cards, and then there is a contact". Until now
  // a message carried no name: whoever wrote to you was a row named by its key on every device but the one that
  // scanned their card. Now: while no pair roster exists with the peer (the first exchange), the turn carries the
  // sender's card inside the seal; the receiver hands it to `onCard` only when it names the sender.
  const encode = (obj) => 'onderling-contact://' + Buffer.from(JSON.stringify(obj)).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const MY_CARD = encode({ webid: 'me', displayName: 'Anna', peerAddr: 'me' });
  it('rides the turn whenever it differs from the last one sent to that contact: the first message, a changed name, a new session', async () => {
    // Frits 2026-09-21: "aren't card updates fanned out anyway?" — they are now, with the next message: a name changed
    // under Mij reaches a contact on the next turn to them. A new session sends it once more (650 bytes), which is
    // also how a contact who met you before this change gets your name.
    const sent = [];
    let card = MY_CARD;
    const ch = createContactThreadChannel({ sendToPeer: async (a, p) => { sent.push(p); }, myCard: async () => card });
    await ch.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'hoi', messageId: 'm1' }).sent;
    expect(sent[0].card, 'the first message carries the card').toBe(MY_CARD);
    await ch.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'nog', messageId: 'm2' }).sent;
    expect(sent[1].card, 'the same card does not ride twice').toBeUndefined();
    card = encode({ webid: 'me', displayName: 'Anna B.', peerAddr: 'me' });
    await ch.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'nieuw', messageId: 'm3' }).sent;
    expect(sent[2].card, 'a changed card rides again').toBe(card);
    await ch.sendTurn({ peerAddr: 'cas', threadId: 'cas', text: 'hoi', messageId: 'm4' }).sent;
    expect(sent[3].card, 'per contact: Cas has never had it').toBe(card);
    const fresh = createContactThreadChannel({ sendToPeer: async (a, p) => { sent.push(p); }, myCard: async () => card });
    await fresh.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'weer', messageId: 'm5' }).sent;
    expect(sent[4].card, 'a new session sends it once more').toBe(card);
  });
  it('rides INSIDE the seal when there is one, and without a `myCard` seam nothing changes', async () => {
    const sent = [];
    const sealFor = vi.fn(async (to, content) => ({ box: JSON.stringify(content) }));
    const ch = createContactThreadChannel({ sendToPeer: async (a, p) => { sent.push(p); }, sealFor, myCard: async () => MY_CARD });
    await ch.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'hoi', messageId: 'm1' }).sent;
    expect(sent[0].card, 'not in the clear beside the box').toBeUndefined();
    expect(JSON.parse(sent[0].sealed.box).card).toBe(MY_CARD);
    const plain = []; const ch2 = createContactThreadChannel({ sendToPeer: async (a, p) => { plain.push(p); } });
    await ch2.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'hoi', messageId: 'm1' }).sent;
    expect(plain[0].card).toBeUndefined();
  });
  it('a card that arrives is handed to `onCard` only when it names the sender; the words land either way', async () => {
    const cards = []; const msgs = [];
    const identityOf = (a) => (a === 'bea-in-pair' ? 'bea' : a);
    const ch = createContactThreadChannel({ sendToPeer: () => {}, identityOf, onCard: (info) => { cards.push(info); } });
    const router = makePeerRouter({ handlers: { [ch.subtypes.out]: ch.messageHandler((m) => msgs.push(m)) } });
    const beaCard = encode({ webid: 'bea', displayName: 'Bea', peerAddr: 'bea' });
    await router({ from: 'bea', payload: { subtype: ch.subtypes.out, text: 'hoi', messageId: 'x1', card: beaCard } });
    expect(cards).toEqual([{ contactId: 'bea', fromAddr: 'bea', card: beaCard }]);
    // over the pair route: the sender is a per-circle address that resolves to the person the card names
    await router({ from: 'bea-in-pair', payload: { subtype: ch.subtypes.out, text: 'nog', messageId: 'x2', card: beaCard } });
    expect(cards.length).toBe(2);
    // a card naming someone else is dropped; the message still lands
    const forged = encode({ webid: 'carl', displayName: 'Carl', peerAddr: 'carl' });
    await router({ from: 'bea', payload: { subtype: ch.subtypes.out, text: 'psst', messageId: 'x3', card: forged } });
    expect(cards.length).toBe(2);
    expect(msgs.map((m) => m.text)).toEqual(['hoi', 'nog', 'psst']);
  });
  it('…and out of the seal too', async () => {
    const cards = [];
    const beaCard = encode({ webid: 'bea', displayName: 'Bea', peerAddr: 'bea' });
    const openFor = vi.fn(async (sealed) => JSON.parse(sealed.box));
    const ch = createContactThreadChannel({ sendToPeer: () => {}, openFor, onCard: (info) => { cards.push(info.card); } });
    const router = makePeerRouter({ handlers: { [ch.subtypes.out]: ch.messageHandler(() => {}) } });
    await router({ from: 'bea', payload: { subtype: ch.subtypes.out, messageId: 'x1', sealed: { box: JSON.stringify({ text: 'hoi', card: beaCard }) } } });
    await new Promise((r) => { setTimeout(r, 0); });   // the seam is fire-and-forget beside the turn
    expect(cards).toEqual([beaCard]);
  });
});
