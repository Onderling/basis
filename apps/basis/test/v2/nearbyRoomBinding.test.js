/**
 * The room binding — two devices on one fake wire. What the shells never had: an ask that actually
 * reaches the other device, an answer that comes back, a card, a chat line, an invite — each validated
 * by the module that owns it, `from` taken from the wire.
 */
import { describe, it, expect, vi } from 'vitest';
import { createNearbyRoomBinding, NEARBY_ROOM_SUBTYPES, faceNoticeFor } from '../../src/v2/nearbyRoomBinding.js';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';
import { createAsk, answerAsk } from '../../src/v2/nearbyAsks.js';
import { createCard, createChatMessage, roomAllows } from '../../src/v2/nearbyRoom.js';
import { prepareBroadcastInvite } from '../../src/v2/nearbyInvites.js';

const T0 = 1_700_000_000_000;
const INVITE_URI = `onderling-invite://${globalThis.btoa(JSON.stringify({ groupId: 'c1', code: 'abc', expiresAt: T0 + 60_000, adminPeerAddr: 'a', relayUrl: 'wss://relay.example' }))}`;
const now = () => T0;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Two bindings whose sends land on each other — the wire stamps `from` with the SENDER's address. */
function pair() {
  const nodes = {};
  const make = (addr, other) => createNearbyRoomBinding({
    sendPeerMessage: async (to, payload) => { nodes[to]?.onPeerMessage(addr, JSON.parse(JSON.stringify(payload))); },
    listPeers: () => [{ pubKey: other }],
    myAddress: () => addr,
    now,
  });
  nodes.a = make('a', 'b');
  nodes.b = make('b', 'a');
  return nodes;
}

describe('an ask crosses, and the answer comes back', () => {
  it('b receives a\'s ask with `from` = a (off the wire), answers, and a receives the answer', async () => {
    const { a, b } = pair();
    const seenByB = []; b.subscribeToAsks((ask) => seenByB.push(ask));
    const answersAtA = []; a.subscribeToAnswers((ans) => answersAtA.push(ans));

    const built = createAsk({ text: 'anyone have a ladder?', tags: ['tools'], from: 'a', now });
    const r = await a.askChannel.broadcast(built.ask);
    expect(r).toMatchObject({ sent: 1, failed: 0, peers: 1 });
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]).toMatchObject({ id: built.ask.id, text: 'anyone have a ladder?', from: 'a' });

    const answer = answerAsk({ ask: seenByB[0], text: 'I do — come by', from: 'b', now }).answer;
    expect((await b.askChannel.sendAnswer(answer, seenByB[0].from)).ok).toBe(true);
    expect(answersAtA).toHaveLength(1);
    expect(answersAtA[0]).toMatchObject({ askId: built.ask.id, text: 'I do — come by', from: 'b' });
  });

  it('a forged `from` in the payload is ignored — the wire wins', async () => {
    const { a, b } = pair();
    const seen = []; b.subscribeToAsks((ask) => seen.push(ask));
    const built = createAsk({ text: 'hi', from: 'someone-else', now });
    await a.askChannel.broadcast({ ...built.ask, from: 'victim' });
    expect(seen[0].from).toBe('a');
  });
});

describe('cards, chat, invites ride the same binding', () => {
  it('a card, a chat line and an invite each reach their subscribers, validated', async () => {
    const { a, b } = pair();
    const cards = []; b.subscribeToCards((c) => cards.push(c));
    const chat = [];  b.subscribeToChat((m) => chat.push(m));
    const invites = []; b.subscribeToInvites((i) => invites.push(i));

    const card = createCard({ label: 'Anna', line: 'has a ladder', tags: ['tools'], from: 'a', now }).card;
    await a.askChannel.broadcastKind('nearby-card', { card });
    const msg = createChatMessage({ text: 'hello room', from: 'a', allows: roomAllows({ chat: true }), now }).message;
    await a.askChannel.broadcastKind('nearby-chat', { message: msg });
    const inv = prepareBroadcastInvite({
      uri: INVITE_URI, circleId: 'c1', circleName: 'Buren',
      expiresAt: T0 + 60_000, allows: { c1: true }, from: 'a', now,
    });
    expect(inv.ok, JSON.stringify(inv)).toBe(true);
    await a.askChannel.broadcastKind('nearby-invite', { invite: inv.invite });

    expect(cards).toHaveLength(1);   expect(cards[0]).toMatchObject({ label: 'Anna', from: 'a' });
    expect(chat).toHaveLength(1);    expect(chat[0]).toMatchObject({ text: 'hello room', from: 'a' });
    expect(invites).toHaveLength(1); expect(invites[0]).toMatchObject({ circleId: 'c1', from: 'a' });
  });

  it('an over-long card is refused on the way in — handled, dropped, no subscriber called', async () => {
    const { a, b } = pair();
    const cards = []; b.subscribeToCards((c) => cards.push(c));
    const handled = b.onPeerMessage('a', { subtype: 'nearby-card', card: { id: 'x', label: 'L'.repeat(5000), line: '', tags: [] } });
    expect(handled).toBe(true);
    expect(cards).toHaveLength(0);
  });
});

describe('who may speak — the room is who the surface lists', () => {
  it('a room payload from a key the surface does not list is dropped (handled, never delivered)', async () => {
    const seen = [];
    const refused = [];
    const b = createNearbyRoomBinding({
      sendPeerMessage: async () => {}, listPeers: () => [{ pubKey: 'a' }], now,
      onError: (err, phase) => refused.push(phase),
    });
    b.subscribeToAsks((ask) => seen.push(ask));
    const ask = createAsk({ text: 'from afar', from: 'z', now }).ask;
    expect(b.onPeerMessage('z', { subtype: 'nearby-ask', ask })).toBe(true);     // ours, refused
    expect(b.handlers['nearby-ask']('z', { subtype: 'nearby-ask', ask })).toBeUndefined();
    expect(seen).toHaveLength(0);
    expect(refused).toEqual(['refuse:nearby-ask', 'refuse:nearby-ask']);
    b.onPeerMessage('a', { subtype: 'nearby-ask', ask });                           // listed → delivered
    expect(seen).toHaveLength(1);
  });
});

describe('an ask that arrives while nobody is listening', () => {
  it('is held (while live) and handed to the next subscriber — the screen was closed, the room was not', async () => {
    const { a, b } = pair();
    const ask = createAsk({ text: 'anyone?', from: 'a', now }).ask;
    await a.askChannel.broadcast(ask);                     // b has no subscriber yet
    expect(b.heldAsks().map((x) => x.id)).toEqual([ask.id]);
    const seen = [];
    b.subscribeToAsks((x) => seen.push(x));                // the screen opens
    expect(seen.map((x) => x.id)).toEqual([ask.id]);
  });

  it('an ask this device ANSWERED is not replayed either', async () => {
    const { a, b } = pair();
    const ask = createAsk({ text: 'anyone?', from: 'a', now }).ask;
    await a.askChannel.broadcast(ask);
    const answer = answerAsk({ ask, text: 'me', from: 'b', now }).answer;
    expect((await b.askChannel.sendAnswer(answer, 'a')).ok).toBe(true);
    expect(b.heldAsks()).toHaveLength(0);
  });

  it('an expired ask is not replayed', async () => {
    let t = T0;
    const nodes = {};
    const make = (addr, other) => createNearbyRoomBinding({
      sendPeerMessage: async (to, payload) => { nodes[to]?.onPeerMessage(addr, payload); },
      listPeers: () => [{ pubKey: other }], myAddress: () => addr, now: () => t,
    });
    nodes.a = make('a', 'b'); nodes.b = make('b', 'a');
    await nodes.a.askChannel.broadcast(createAsk({ text: 'soon gone', from: 'a', now: () => t, ttlMs: 60_000 }).ask);
    t += 61_000;
    const seen = [];
    nodes.b.subscribeToAsks((x) => seen.push(x));
    expect(seen).toHaveLength(0);
    expect(nodes.b.heldAsks()).toHaveLength(0);
  });
});

describe('the router', () => {
  it('claims exactly the room\'s subtypes and leaves the rest to other handlers', () => {
    const { b } = pair();
    expect(Object.keys(b.handlers).sort()).toEqual([...NEARBY_ROOM_SUBTYPES].sort());
    expect(b.onPeerMessage('a', { subtype: 'roster-updated' })).toBe(false);
    expect(b.onPeerMessage('a', null)).toBe(false);
  });

  it('a throwing subscriber does not stop its siblings', async () => {
    const { a, b } = pair();
    const good = vi.fn();
    b.subscribeToAsks(() => { throw new Error('bad render'); });
    b.subscribeToAsks(good);
    await a.askChannel.broadcast(createAsk({ text: 'x', from: 'a', now }).ask);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery; close() drops everyone', async () => {
    const { a, b } = pair();
    const fn = vi.fn();
    const off = b.subscribeToAsks(fn);
    await a.askChannel.broadcast(createAsk({ text: 'one', from: 'a', now }).ask);
    off();
    await a.askChannel.broadcast(createAsk({ text: 'two', from: 'a', now }).ask);
    expect(fn).toHaveBeenCalledTimes(1);
    b.subscribeToAsks(fn);                                 // re-opening replays the live asks (one, two)
    expect(fn).toHaveBeenCalledTimes(3);
    b.close();
    await a.askChannel.broadcast(createAsk({ text: 'three', from: 'a', now }).ask);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(b.heldAsks()).toHaveLength(1);                 // held for whoever opens the room next
  });
});

describe('through the controller — the screen actually asks the room', () => {
  it('askRoom reports the real reach and the other device\'s screen lists the ask', async () => {
    const { a, b } = pair();
    const screenA = createNearbyScreen({ ...a.screenDeps(), t: (k) => k, now });
    const screenB = createNearbyScreen({ ...b.screenDeps(), t: (k) => k, now });
    screenA.open(); screenB.open();
    const r = await screenA.askRoom({ text: 'anyone have a ladder?' });
    expect(r).toMatchObject({ ok: true, sent: 1, peers: 1 });
    await tick();
    const asksAtB = screenB.model().asks;
    expect(asksAtB).toHaveLength(1);
    expect(asksAtB[0].ask).toMatchObject({ text: 'anyone have a ladder?', from: 'a' });
    screenA.close(); screenB.close();
  });
});

describe('the room outlives the screen, and re-tells itself to a newcomer', () => {
  /** Two bindings with a shared, mutable room list and a peer feed each side can be told about. */
  function roomOf() {
    const nodes = {}; const feeds = {};
    const peers = { a: [], b: [] };
    const make = (addr, face) => createNearbyRoomBinding({
      sendPeerMessage: async (to, payload) => { nodes[to]?.onPeerMessage(addr, JSON.parse(JSON.stringify(payload))); return { delivered: true }; },
      listPeers: () => peers[addr],
      subscribeToPeers: (fn) => { feeds[addr] = fn; return () => { feeds[addr] = null; }; },
      myAddress: () => addr, myFace: () => face, now,
    });
    nodes.a = make('a', { label: 'Anna' });
    nodes.b = make('b', { label: 'Bram' });
    const arrive = async (who, other) => { peers[who] = [{ pubKey: other }]; feeds[who]?.(peers[who]); await nodes[who].settled(); };
    return { ...nodes, arrive, peers };
  }

  it('a card shown while the screen was away is there when it comes back; chat is live-only (L65)', async () => {
    const { a, b, arrive } = roomOf();
    await arrive('a', 'b'); await arrive('b', 'a');
    await a.askChannel.broadcastKind('nearby-card', { card: createCard({ label: 'Anna', line: 'ladder', from: 'a', now }).card });
    await a.askChannel.broadcastKind('nearby-chat', { message: createChatMessage({ text: 'hi room', from: 'a', allows: roomAllows({ chat: true }), now }).message });
    const cards = []; const chat = [];
    b.subscribeToCards((c) => cards.push(c));   // the screen opens AFTER both arrived
    b.subscribeToChat((m) => chat.push(m));
    expect(cards.map((c) => c.label)).toEqual(['Anna']);
    expect(chat).toHaveLength(0);               // "don't record anything, they just miss out" — Frits
  });

  it('a newcomer is told my live ask, my card and my face — not the chat', async () => {
    const { a, b, arrive } = roomOf();
    // a is alone in the room and says things into it; b is not there yet.
    await a.askChannel.broadcast(createAsk({ text: 'ladder?', from: 'a', now }).ask);
    await a.askChannel.broadcastKind('nearby-card', { card: createCard({ label: 'Anna', line: 'x', from: 'a', now }).card });
    await a.askChannel.broadcastKind('nearby-chat', { message: createChatMessage({ text: 'old line', from: 'a', allows: roomAllows({ chat: true }), now }).message });
    // Nothing reached b (b was nowhere). Then b walks in: the handshake lists each on the other's side,
    // and a greets the newcomer.
    const asks = []; const cards = []; const chat = []; const faces = [];
    b.subscribeToAsks((x) => asks.push(x)); b.subscribeToCards((x) => cards.push(x));
    b.subscribeToChat((x) => chat.push(x)); b.subscribeToPresence((x) => faces.push(x));
    await arrive('b', 'a');
    await arrive('a', 'b');
    expect(asks.map((x) => x.text)).toEqual(['ladder?']);
    expect(cards.map((x) => x.label)).toEqual(['Anna']);
    expect(faces.map((x) => x.label)).toEqual(['Anna']);
    expect(chat).toHaveLength(0);
    expect(b.presenceOf('a')?.label).toBe('Anna');
  });

  it('a peer who leaves takes their card and face with them; an empty room forgets the chat', async () => {
    const { a, b, arrive, peers } = roomOf();
    await arrive('a', 'b'); await arrive('b', 'a');
    await a.askChannel.broadcastKind('nearby-card', { card: createCard({ label: 'Anna', line: 'x', from: 'a', now }).card });
    await a.askChannel.broadcastKind('nearby-chat', { message: createChatMessage({ text: 'hi', from: 'a', allows: roomAllows({ chat: true }), now }).message });
    expect(b.heldCards()).toHaveLength(1);
    peers.b = [];                                               // a left b's room
    expect(b.heldCards()).toHaveLength(0);
  });

  it('reach counts what the transport handed over, not what was attempted', async () => {
    let n = 0;
    const b = createNearbyRoomBinding({
      sendPeerMessage: async () => ({ delivered: (n++ % 2) === 0 }),
      listPeers: () => [{ pubKey: 'x' }, { pubKey: 'y' }, { pubKey: 'z' }], now,
    });
    const r = await b.askChannel.broadcast(createAsk({ text: 'q', from: 'me', now }).ask);
    expect(r).toMatchObject({ sent: 3, failed: 0, reached: 2, peers: 3 });
  });
});

describe('heard, not sent — the room rides the app\'s delivery receipts', () => {
  it('a room payload carries its msgId, the receiver confirms through the shell\'s receipt sender, the sender counts', async () => {
    const wire = [];
    const receipts = [];
    const map = new Map();
    const deliveryMap = { get: (k) => (map.has(k) ? map.get(k) : null), set: (k, v) => map.set(k, v) };
    const nodes = {};
    const make = (addr, other) => createNearbyRoomBinding({
      sendPeerMessage: async (to, payload) => { wire.push({ from: addr, to, payload }); nodes[to]?.onPeerMessage(addr, payload); return { delivered: true }; },
      listPeers: () => [{ pubKey: other }], myAddress: () => addr, now, deliveryMap: addr === 'a' ? deliveryMap : null,
    });
    nodes.a = make('a', 'b'); nodes.b = make('b', 'a');
    nodes.b.setLandedHook(async (info) => { receipts.push(info); });
    const heardAtA = []; nodes.a.subscribeToHeard((h) => heardAtA.push(h));

    const ask = createAsk({ text: 'ladder?', from: 'a', now }).ask;
    await nodes.a.askChannel.broadcast(ask);
    expect(wire[0].payload.msgId).toBe(ask.id);                       // stamped with the object's own id
    expect(map.get(ask.id)).toBe('maybe-received');                   // the shell's map knows the send
    expect(receipts).toEqual([{ msgId: ask.id, fromPeerAddr: 'a', source: 'receiver' }]);   // b's shell would now send the receipt

    // …and when that receipt reaches a's shell, its handler feeds the binding:
    expect(nodes.a.onReceipt('b', { subtype: 'delivery-receipt', messageId: ask.id })).toBe(true);
    expect(nodes.a.heardBy(ask.id)).toBe(1);
    expect(heardAtA).toEqual([{ msgId: ask.id, heard: 1 }]);
    nodes.a.onReceipt('b', { subtype: 'delivery-receipt', messageId: ask.id });   // a repeat is not a second peer
    expect(nodes.a.heardBy(ask.id)).toBe(1);
    expect(nodes.a.onReceipt('b', { subtype: 'delivery-receipt', messageId: 'not-ours' })).toBe(false);
  });

  it('a refused payload is not confirmed', async () => {
    const receipts = [];
    const b = createNearbyRoomBinding({ sendPeerMessage: async () => {}, listPeers: () => [{ pubKey: 'a' }], now });
    b.setLandedHook(async (info) => { receipts.push(info); });
    b.onPeerMessage('a', { subtype: 'nearby-card', msgId: 'c1', card: { id: 'c1', label: 'L'.repeat(5000), line: '', tags: [] } });
    b.onPeerMessage('z', { subtype: 'nearby-ask', msgId: 'x', ask: createAsk({ text: 'hi', from: 'z', now }).ask });
    expect(receipts).toEqual([]);
  });
});

describe('the invite door — announcing a circle invite into the room', () => {
  it('announces to whoever is listed, tells newcomers, and reports the real reach', async () => {
    const { a, b } = pair();
    const invites = []; b.subscribeToInvites((i) => invites.push(i));
    const res = await a.announceInvite({ uri: INVITE_URI, circleId: 'c1', circleName: 'Buren', expiresAt: T0 + 60_000 });
    expect(res).toMatchObject({ ok: true, sent: 1, peers: 1 });
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ circleId: 'c1', circleName: 'Buren', from: 'a' });
  });

  it('an empty room is said, not hidden', async () => {
    const a = createNearbyRoomBinding({ sendPeerMessage: async () => {}, listPeers: () => [], now });
    expect(await a.announceInvite({ uri: INVITE_URI, circleId: 'c1' })).toMatchObject({ ok: false, reason: 'nobody-nearby', peers: 0 });
  });
});

describe('rung 4 — the deliberate reach exchange', () => {
  function reachPair() {
    const nodes = {};
    const make = (addr, other, mine) => createNearbyRoomBinding({
      sendPeerMessage: async (to, payload) => { nodes[to]?.onPeerMessage(addr, JSON.parse(JSON.stringify(payload))); return { delivered: true }; },
      listPeers: () => [{ pubKey: other }], myAddress: () => addr, now,
      myAddresses: () => mine,
    });
    nodes.a = make('a', 'b', { relay: { url: 'wss://relay.a' }, nkn: { address: 'nkn-a' } });
    nodes.b = make('b', 'a', { relay: { url: 'wss://relay.b' } });
    return nodes;
  }

  it('one tap shares mine and asks back; the other side sees the ask and can answer with theirs', async () => {
    const { a, b } = reachPair();
    const atB = []; b.subscribeToReach((r) => atB.push(r));
    const atA = []; a.subscribeToReach((r) => atA.push(r));
    const r = await a.shareReach('b');
    expect(r.ok).toBe(true);
    expect(atB).toHaveLength(1);
    expect(atB[0]).toMatchObject({ from: 'a', wantBack: true, transports: { relay: { url: 'wss://relay.a' }, nkn: { address: 'nkn-a' } } });
    expect(b.pendingReachFrom('a')).toBeTruthy();
    const back = await b.shareReach('a', { wantBack: false });
    expect(back.ok).toBe(true);
    expect(b.pendingReachFrom('a')).toBeNull();               // answering settles the ask
    expect(atA[0]).toMatchObject({ from: 'b', wantBack: false, transports: { relay: { url: 'wss://relay.b' } } });
  });

  it('the answer still lands after the sender left the room (the rung is not proximity-gated)', async () => {
    const b = createNearbyRoomBinding({ sendPeerMessage: async () => {}, listPeers: () => [], now });
    const seen = []; b.subscribeToReach((r) => seen.push(r));
    expect(b.onPeerMessage('a', { subtype: 'nearby-reach', reach: { transports: { relay: { url: 'wss://x' } }, wantBack: false } })).toBe(true);
    expect(seen).toHaveLength(1);
    expect(b.pendingReachFrom('a')).toBeNull();               // a gift needs no settling — no ask-back bar
  });

  it('a reach with nothing usable in it is refused; sharing with nothing to share says so', async () => {
    const { b } = reachPair();
    expect(b.onPeerMessage('a', { subtype: 'nearby-reach', reach: { transports: {} } })).toBe(true);
    expect(b.pendingReachFrom('a')).toBeNull();
    const none = createNearbyRoomBinding({ sendPeerMessage: async () => {}, listPeers: () => [{ pubKey: 'x' }], now });
    expect(await none.shareReach('x')).toMatchObject({ ok: false, reason: 'nothing-to-share' });
  });
});

describe('my asks carry their heard counts (the ask row)', () => {
  it('myAsks() lists what I asked, and the count moves with the receipts', async () => {
    const { a } = pair();
    const ask = createAsk({ text: 'ladder?', from: 'a', now }).ask;
    await a.askChannel.broadcast(ask);
    expect(a.myAsks()).toMatchObject([{ ask: { id: ask.id }, heard: 0 }]);
    a.onReceipt('b', { subtype: 'delivery-receipt', messageId: ask.id });
    expect(a.myAsks()[0].heard).toBe(1);
  });
});

describe('the face picker (L63)', () => {
  it('announceFace tells everyone listed the current face, now', async () => {
    const sent = [];
    let label = 'Frits';
    const b = createNearbyRoomBinding({
      sendPeerMessage: async (to, payload) => { sent.push({ to, payload }); },
      listPeers: () => [{ pubKey: 'x' }, { pubKey: 'y' }],
      myFace: () => (label ? { label } : null), now,
    });
    expect(await b.announceFace()).toEqual({ announced: 2, label: 'Frits' });
    expect(sent.map((s) => s.payload)).toMatchObject([
      { subtype: 'nearby-presence', presence: { label: 'Frits' } },
      { subtype: 'nearby-presence', presence: { label: 'Frits' } },
    ]);
    // "Nobody" — or a handle the profile does not have. Either way the room is holding a name that is
    // no longer yours, and staying silent leaves it there for as long as the peer is listed. A face
    // that resolves to nothing is a RETRACTION, and it has to travel.
    label = null;
    sent.length = 0;
    // The null label comes back too: "handle" with no handle set looks exactly like "Nobody" from the
    // outside, and the shell can only say so if the binding tells it what actually went out.
    expect(await b.announceFace()).toEqual({ announced: 2, label: null });
    expect(sent.map((s) => s.payload)).toMatchObject([
      { subtype: 'nearby-presence', presence: { label: null } },
      { subtype: 'nearby-presence', presence: { label: null } },
    ]);
  });

  it('the shells are told when a pick announced nothing — and NOT when "Nobody" was the pick', () => {
    // Both shells ask this one function rather than reading `result.label` themselves: the two of them
    // deciding it separately is exactly how a rule like this drifts into two rules.
    expect(faceNoticeFor({ choice: 'handle', result: { announced: 2, label: null } })).toEqual({ key: 'face_empty' });
    expect(faceNoticeFor({ choice: 'name',   result: { announced: 0, label: null } })).toEqual({ key: 'face_empty' });
    expect(faceNoticeFor({ choice: 'none',   result: { announced: 2, label: null } }),
      'choosing Nobody got exactly what it asked for').toBeNull();
    expect(faceNoticeFor({ choice: 'handle', result: { announced: 2, label: 'Ada' } })).toBeNull();
    expect(faceNoticeFor({ choice: 'handle', result: undefined }),
      'no room wired ⇒ nothing to report').toBeNull();
  });

  it('a retraction arriving from a peer CLEARS the label it had set', async () => {
    const b = createNearbyRoomBinding({
      sendPeerMessage: async () => {}, listPeers: () => [{ pubKey: 'peer-1' }], now,
    });
    b.onPeerMessage('peer-1', { subtype: 'nearby-presence', presence: { label: 'Ada' } });
    expect(b.presenceOf('peer-1')).toMatchObject({ label: 'Ada' });

    b.onPeerMessage('peer-1', { subtype: 'nearby-presence', presence: { label: null } });
    expect(b.presenceOf('peer-1'), 'the stored face is cleared, not left at its last value')
      .toMatchObject({ label: null });
  });
});
