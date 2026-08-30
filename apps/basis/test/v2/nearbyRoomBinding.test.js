/**
 * The room binding — two devices on one fake wire. What the shells never had: an ask that actually
 * reaches the other device, an answer that comes back, a card, a chat line, an invite — each validated
 * by the module that owns it, `from` taken from the wire.
 */
import { describe, it, expect, vi } from 'vitest';
import { createNearbyRoomBinding, NEARBY_ROOM_SUBTYPES } from '../../src/v2/nearbyRoomBinding.js';
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
    b.subscribeToAsks(fn); b.close();
    await a.askChannel.broadcast(createAsk({ text: 'three', from: 'a', now }).ask);
    expect(fn).toHaveBeenCalledTimes(1);
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
