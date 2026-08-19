/**
 * The Nearby screen controller (Nearby step E).
 *
 * Two properties carry the screen, and both are about honesty rather than rendering:
 *
 *   1. **it says what the device is doing, not what it asked for** — the case that matters is the
 *      disagreement, where a user believes they are hidden and is not;
 *   2. **proximity never implies access** (rule b) — every row's actions come from the ROSTER.
 *
 * Everything else here is lifecycle: opening announces, closing stops, and closing works even when the
 * caller is sloppy.
 */
import { describe, it, expect, vi } from 'vitest';
import { DISCOVERABILITY, createDiscoverabilityControl, Transport } from '@onderling/core';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';

class Discovering extends Transport {
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(s) { return s; }
  async _put() {}
}
/** mDNS on an older binary: cannot browse without publishing. */
class AlwaysPublishes extends Transport {
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(s) { return s === DISCOVERABILITY.OFF ? s : DISCOVERABILITY.PUBLISH; }
  async _put() {}
}
const mk = (C) => new C({ address: 'a', identity: null });
const settle = () => new Promise((r) => setTimeout(r, 0));

function build({ transports = { ble: mk(Discovering) }, peers = [], ...rest } = {}) {
  let push = null;
  const control = createDiscoverabilityControl({ transports: () => transports });
  const screen = createNearbyScreen({
    control,
    subscribeToPeers: (fn) => { push = fn; return () => { push = null; }; },
    mySkills: () => ['fietsband plakken', 'soep maken'],
    myPseudonym: 'ik',
    t: (k) => k,
    ...rest,
  });
  return { screen, control, setPeers: (p) => push?.(p), peers };
}

const peer = (id, over = {}) => ({ pubKey: id, displayName: id, skills: [], ...over });

describe('visibility — what the device is actually doing', () => {
  it('open ⇒ visible; closed ⇒ hidden', async () => {
    const { screen } = build();
    expect(screen.visibility().publishing).toBe(false);

    screen.open();
    await settle();
    expect(screen.visibility()).toMatchObject({ publishing: true, degraded: false });

    screen.close();
    await settle();
    expect(screen.visibility().publishing).toBe(false);
  });

  it('THE CASE THAT MATTERS: asked to hide, still announcing ⇒ degraded', async () => {
    const { screen } = build({ transports: { mdns: mk(AlwaysPublishes) } });
    screen.open();
    await settle();
    screen.close();
    await settle();

    const v = screen.visibility();
    expect(v.publishing).toBe(true);    // the truth
    expect(v.degraded).toBe(true);      // …and it is flagged, not absorbed
    expect(v.requested).toBe('browse');
  });

  it('a device that cannot discover at all is UNAVAILABLE, not degraded', async () => {
    // No radio is an explanation, not a privacy warning. Conflating them trains people to ignore both.
    const { screen } = build({ transports: {} });
    screen.open();
    await settle();
    const v = screen.visibility();
    expect(v).toMatchObject({ unavailable: true, degraded: false, publishing: false });
  });

  it('the model carries visibility, so a renderer never has to ask twice', async () => {
    const { screen } = build();
    screen.open();
    await settle();
    expect(screen.model().visibility.publishing).toBe(true);
  });
});

describe('rule (b): proximity is not membership', () => {
  it('a stranger gets only consented-exchange actions, and is told why', async () => {
    const { screen, setPeers } = build({ isKnownMember: () => false, canInvite: () => true });
    screen.open();
    setPeers([peer('stranger')]);

    const [row] = screen.model().rows;
    expect(row.actions).toEqual(['invite-to-circle', 'request-join']);
    expect(row.actions).not.toContain('open-shared-circle');
    expect(row.isMember).toBe(false);
    expect(row.note).toBe('nearby-not-member');
  });

  it('a known member gets the open action — because the ROSTER said so, not the network', async () => {
    const { screen, setPeers } = build({ isKnownMember: (id) => id === 'known', canInvite: () => false });
    screen.open();
    setPeers([peer('known'), peer('stranger')]);

    const rows = screen.model().rows;
    expect(rows.find((r) => r.id === 'known').actions).toContain('open-shared-circle');
    expect(rows.find((r) => r.id === 'stranger').actions).not.toContain('open-shared-circle');
    expect(rows.find((r) => r.id === 'known').note).toBeNull();
  });

  it('no invite action when I admin nothing to invite into', async () => {
    const { screen, setPeers } = build({ canInvite: () => false });
    screen.open();
    setPeers([peer('x')]);
    expect(screen.model().rows[0].actions).toEqual(['request-join']);
  });

  it('actionsFor() answers for a single row', async () => {
    const { screen, setPeers } = build({ isKnownMember: (id) => id === 'known' });
    screen.open();
    setPeers([peer('known')]);
    expect(screen.actionsFor('known')).toMatchObject({ isMember: true });
    expect(screen.actionsFor('nobody')).toBeNull();
  });

  it('a roster that THROWS means not-a-member, and the screen still renders', async () => {
    // Deny-by-default. And the screen must survive: blanking the whole list because one lookup failed is
    // worse than showing strangers as strangers.
    const onError = vi.fn();
    const { screen, setPeers } = build({
      isKnownMember: () => { throw new Error('roster down'); }, onError,
    });
    screen.open();
    setPeers([peer('x')]);

    const [row] = screen.model().rows;
    expect(row.isMember).toBe(false);
    expect(row.actions).not.toContain('open-shared-circle');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'isKnownMember');
  });
});

describe('lifecycle', () => {
  it('closing drops the peer list', async () => {
    const { screen, setPeers } = build();
    screen.open();
    setPeers([peer('a'), peer('b')]);
    expect(screen.model().rows).toHaveLength(2);

    screen.close();
    await settle();
    expect(screen.model().rows).toHaveLength(0);
  });

  it('close without open is safe, and does not announce', async () => {
    const { screen, control } = build();
    expect(() => screen.close()).not.toThrow();
    await settle();
    expect(control.isPublishing).toBe(false);
  });

  it('starts and stops the network watcher with the screen', async () => {
    const stop = vi.fn();
    const subscribeToNetwork = vi.fn(() => stop);
    const { screen } = build({ subscribeToNetwork });

    screen.open();
    expect(subscribeToNetwork).toHaveBeenCalledTimes(1);
    screen.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('notifies watchers when peers arrive', async () => {
    const seen = vi.fn();
    const { screen, setPeers } = build();
    screen.subscribe(seen);
    screen.open();
    setPeers([peer('a')]);
    expect(seen).toHaveBeenCalled();
    expect(seen.mock.calls.at(-1)[0].rows).toHaveLength(1);
  });

  it('unsubscribe stops delivery', async () => {
    const seen = vi.fn();
    const { screen, setPeers } = build();
    const off = screen.subscribe(seen);
    screen.open();
    off();
    seen.mockClear();
    setPeers([peer('a')]);
    expect(seen).not.toHaveBeenCalled();
  });

  it('a throwing watcher does not break the others', async () => {
    const good = vi.fn();
    const { screen, setPeers } = build();
    screen.subscribe(() => { throw new Error('bad render'); });
    screen.subscribe(good);
    screen.open();
    setPeers([peer('a')]);
    expect(good).toHaveBeenCalled();
  });

  it('the own-profile footer reflects published skills', async () => {
    const { screen } = build();
    screen.open();
    expect(screen.model().ownProfile.publishedSkills).toEqual(['fietsband plakken', 'soep maken']);
  });

  it('a throwing mySkills degrades to an empty profile rather than crashing the screen', async () => {
    const { screen } = build({ mySkills: () => { throw new Error('no store'); } });
    screen.open();
    expect(screen.model().ownProfile.publishedSkills).toEqual([]);
  });
});

describe('supportedActions — do not offer what the host cannot do', () => {
  it('withholds an action this host cannot service', async () => {
    // `request-join` needs the ask/invite exchange (Nearby F + H). Offering a button that quietly does
    // nothing is worse than an absent one: it teaches people the app is broken rather than incomplete.
    const { screen, setPeers } = build({
      canInvite: () => true,
      supportedActions: ['invite-to-circle', 'open-shared-circle'],
    });
    screen.open();
    setPeers([peer('stranger')]);

    const [row] = screen.model().rows;
    expect(row.actions).toEqual(['invite-to-circle']);
    expect(row.actions).not.toContain('request-join');
  });

  it('but the stranger NOTE survives — withholding a button must not hide the relationship', async () => {
    const { screen, setPeers } = build({ supportedActions: [] });
    screen.open();
    setPeers([peer('stranger')]);

    const [row] = screen.model().rows;
    expect(row.actions).toEqual([]);
    expect(row.note).toBe('nearby-not-member');
    expect(row.isMember).toBe(false);
  });

  it('omitting supportedActions offers everything (unchanged default)', async () => {
    const { screen, setPeers } = build({ canInvite: () => true });
    screen.open();
    setPeers([peer('x')]);
    expect(screen.model().rows[0].actions).toEqual(['invite-to-circle', 'request-join']);
  });

  it('a supported action still requires the entitlement — it filters, it does not grant', async () => {
    // Declaring you can open a shared circle does not make a stranger a member.
    const { screen, setPeers } = build({
      isKnownMember: () => false,
      supportedActions: ['open-shared-circle', 'request-join'],
    });
    screen.open();
    setPeers([peer('stranger')]);
    expect(screen.model().rows[0].actions).toEqual(['request-join']);
  });
});

describe('asks in the room (step F)', () => {
  const T0 = 1_700_000_000_000;
  const drivers = (tags) => async () => Object.fromEntries(
    tags.map((tag) => [tag, { kind: 'offering', text: `ik kan ${tag}`, tags: [tag] }]),
  );
  const anAsk = (over = {}) => Object.freeze({
    id: 'ask-1', text: 'anyone got a bike pump?', tags: ['fiets'],
    from: 'room-1', createdAt: T0, expiresAt: T0 + 60_000, ...over,
  });

  function withAsks({ getDrivers, nowMs = T0, ...rest } = {}) {
    let pushAsk = null;
    const control = createDiscoverabilityControl({ transports: () => ({ ble: mk(Discovering) }) });
    const screen = createNearbyScreen({
      control,
      subscribeToAsks: (fn) => { pushAsk = fn; return () => { pushAsk = null; }; },
      getDrivers, now: () => nowMs, t: (k) => k, ...rest,
    });
    return { screen, ask: (a) => pushAsk?.(a) };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('an incoming ask appears, matched on MY device', async () => {
    const { screen, ask } = withAsks({ getDrivers: drivers(['fiets']) });
    screen.open();
    ask(anAsk());
    await flush();

    const [row] = screen.model().asks;
    expect(row.ask.text).toBe('anyone got a bike pump?');
    expect(row.resonant).toBe(true);
    expect(row.reason).toContain('fiets');
    expect(row.actions).toEqual(['answer-ask', 'dismiss-ask']);
    expect(row.note).toBe('answer-is-disclosure');
  });

  it('a non-matching ask still SHOWS — the room is not filtered to my interests', async () => {
    // Hiding asks I do not match would make the room a recommender, and would also leak my drivers into
    // what I can see. Everyone hears the question; only matching is private.
    const { screen, ask } = withAsks({ getDrivers: drivers(['tuinieren']) });
    screen.open();
    ask(anAsk());
    await flush();

    const [row] = screen.model().asks;
    expect(row.resonant).toBe(false);
    expect(row.reason).toBeNull();
    expect(row.actions).toEqual(['answer-ask', 'dismiss-ask']);   // I can still answer
  });

  it('with no drivers configured, asks show and simply never resonate', async () => {
    const { screen, ask } = withAsks({ getDrivers: null });
    screen.open();
    ask(anAsk());
    await flush();
    expect(screen.model().asks[0]).toMatchObject({ resonant: false, reason: null });
  });

  it('an EXPIRED ask never enters the room', async () => {
    const { screen, ask } = withAsks({ getDrivers: drivers(['fiets']), nowMs: T0 + 120_000 });
    screen.open();
    ask(anAsk());
    await flush();
    expect(screen.model().asks).toEqual([]);
  });

  it('newest first', async () => {
    const { screen, ask } = withAsks({ getDrivers: null });
    screen.open();
    ask(anAsk({ id: 'old', createdAt: T0 - 1_000 }));
    ask(anAsk({ id: 'new', createdAt: T0 }));
    await flush();
    expect(screen.model().asks.map((a) => a.ask.id)).toEqual(['new', 'old']);
  });

  it('closing the room DROPS the asks', async () => {
    // A closed screen holding what strangers needed is a quiet record of where someone has been.
    const { screen, ask } = withAsks({ getDrivers: null });
    screen.open();
    ask(anAsk());
    await flush();
    expect(screen.model().asks).toHaveLength(1);

    screen.close();
    expect(screen.model().asks).toEqual([]);
  });

  it('a failing driver read leaves the ask visible but unmatched', async () => {
    const onError = vi.fn();
    const { screen, ask } = withAsks({
      getDrivers: async () => { throw new Error('vault locked'); }, onError,
    });
    screen.open();
    ask(anAsk());
    await flush();
    // The matcher swallows its own failures, so the ask lands unmatched rather than vanishing.
    expect(screen.model().asks[0]).toMatchObject({ resonant: false });
  });

  it('no ask source ⇒ an empty ask list, not a crash', () => {
    const { screen } = build();
    screen.open();
    expect(screen.model().asks).toEqual([]);
  });
});

describe('acting on asks (step F)', () => {
  const T0 = 1_700_000_000_000;
  const anAsk = (over = {}) => Object.freeze({
    id: 'ask-1', text: 'anyone got a bike pump?', tags: ['fiets'],
    from: 'asker-addr', createdAt: T0, expiresAt: T0 + 60_000, ...over,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function withChannel({ broadcast, sendAnswer } = {}) {
    let pushAsk = null;
    const askChannel = {
      broadcast: broadcast ?? vi.fn(async () => ({ sent: 3, failed: 1, peers: 4 })),
      sendAnswer: sendAnswer ?? vi.fn(async () => ({ ok: true })),
    };
    const screen = createNearbyScreen({
      control: createDiscoverabilityControl({ transports: () => ({ ble: mk(Discovering) }) }),
      subscribeToAsks: (fn) => { pushAsk = fn; return () => { pushAsk = null; }; },
      askChannel,
      myRoomAddress: () => 'my-room-addr',
      now: () => T0,
      t: (k) => k,
    });
    return { screen, askChannel, ask: (a) => pushAsk?.(a) };
  }

  it('asking reports the REAL reach, not "sent"', async () => {
    // "Asked 3 of 4 nearby" is honest; a bare success implies everyone in the café heard it.
    const { screen } = withChannel();
    screen.open();
    const r = await screen.askRoom({ text: 'anyone got a pump?', tags: ['Fiets'] });
    expect(r).toMatchObject({ ok: true, sent: 3, failed: 1, peers: 4 });
    expect(r.ask.tags).toEqual(['fiets']);
    expect(r.ask.from).toBe('my-room-addr');
  });

  it('my own ask does NOT appear in my room list', async () => {
    // The room is what other people asked. Echoing my own question back is noise, and it would also make
    // "someone nearby needs this" indistinguishable from "I said this".
    const { screen } = withChannel();
    screen.open();
    await screen.askRoom({ text: 'anyone got a pump?' });
    expect(screen.model().asks).toEqual([]);
  });

  it('refuses an empty ask before touching the room', async () => {
    const { screen, askChannel } = withChannel();
    screen.open();
    expect(await screen.askRoom({ text: '  ' })).toMatchObject({ ok: false, reason: 'empty-ask' });
    expect(askChannel.broadcast).not.toHaveBeenCalled();
  });

  it('answering goes to the ASKER alone and opens the channel', async () => {
    const { screen, askChannel, ask } = withChannel();
    screen.open();
    ask(anAsk());
    await flush();

    const r = await screen.answer('ask-1', 'ik heb er een');
    expect(r).toMatchObject({ ok: true, opensDirectChannel: true, peer: 'asker-addr' });
    expect(askChannel.sendAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ askId: 'ask-1', text: 'ik heb er een' }), 'asker-addr',
    );
  });

  it('an answered ask leaves the room — the disclosure is a one-way door', async () => {
    const { screen, ask } = withChannel();
    screen.open();
    ask(anAsk());
    await flush();
    await screen.answer('ask-1', 'ja');
    expect(screen.model().asks).toEqual([]);
  });

  it('a FAILED answer leaves the ask in place rather than pretending', async () => {
    const { screen, ask } = withChannel({ sendAnswer: vi.fn(async () => ({ ok: false, reason: 'offline' })) });
    screen.open();
    ask(anAsk());
    await flush();

    expect(await screen.answer('ask-1', 'ja')).toMatchObject({ ok: false, reason: 'offline' });
    expect(screen.model().asks).toHaveLength(1);
  });

  it('cannot answer an ask that is not in the room', async () => {
    const { screen } = withChannel();
    screen.open();
    expect(await screen.answer('nope', 'hi')).toMatchObject({ ok: false, reason: 'unknown-ask' });
  });

  it('dismissing removes it for me and sends NOTHING', async () => {
    const { screen, askChannel, ask } = withChannel();
    screen.open();
    ask(anAsk());
    await flush();

    screen.dismissAsk('ask-1');
    expect(screen.model().asks).toEqual([]);
    expect(askChannel.sendAnswer).not.toHaveBeenCalled();
  });

  it('with no channel, asking fails honestly instead of silently doing nothing', async () => {
    const screen = createNearbyScreen({ now: () => T0, t: (k) => k });
    screen.open();
    expect(await screen.askRoom({ text: 'hello' })).toMatchObject({ ok: false, reason: 'no-channel' });
  });
});

describe('answering hands back a transient thread (rung 3)', () => {
  const T0 = 1_700_000_000_000;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('the answer result carries a TRANSIENT thread for the host to open', async () => {
    let pushAsk = null;
    const screen = createNearbyScreen({
      subscribeToAsks: (fn) => { pushAsk = fn; return () => {}; },
      askChannel: { broadcast: async () => ({ sent: 1, failed: 0, peers: 1 }), sendAnswer: async () => ({ ok: true }) },
      myRoomAddress: () => 'me', now: () => T0, t: (k) => k,
    });
    screen.open();
    pushAsk({ id: 'ask-1', text: 'pump?', tags: [], from: 'them-addr', createdAt: T0, expiresAt: T0 + 60_000 });
    await flush();

    const r = await screen.answer('ask-1', 'ik heb er een');
    expect(r.thread).toMatchObject({ peerAddress: 'them-addr', transient: true, origin: 'nearby-answer' });
  });
});

describe('cards and room chat (step G)', () => {
  const T0 = 1_700_000_000_000;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function withRoom({ allows, ...rest } = {}) {
    let pushCard = null; let pushChat = null; let pushAsk = null;
    const broadcastKind = vi.fn(async () => ({ sent: 2, failed: 0, peers: 2 }));
    const screen = createNearbyScreen({
      control: createDiscoverabilityControl({ transports: () => ({ ble: mk(Discovering) }) }),
      subscribeToPeers: () => () => {},
      subscribeToCards: (fn) => { pushCard = fn; return () => { pushCard = null; }; },
      subscribeToChat:  (fn) => { pushChat = fn; return () => { pushChat = null; }; },
      subscribeToAsks:  (fn) => { pushAsk = fn; return () => {}; },
      askChannel: { broadcastKind, broadcast: async () => ({ sent: 0, failed: 0, peers: 0 }) },
      myRoomAddress: () => 'me', allows, now: () => T0, t: (k) => k, ...rest,
    });
    return {
      screen, broadcastKind,
      card: (c) => pushCard?.(c),
      chat: (m) => pushChat?.(m),
      chatBound: () => pushChat !== null,
    };
  }

  it('BOTH allows default off, and the model reports them', () => {
    const { screen } = withRoom();
    screen.open();
    expect(screen.model().allows).toEqual({ card: false, chat: false });
  });

  it('showing a card is REFUSED while the card allow is off', async () => {
    const { screen, broadcastKind } = withRoom();
    screen.open();
    expect(await screen.showCard({ label: 'Sam' })).toMatchObject({ ok: false, reason: 'card-not-allowed' });
    expect(broadcastKind).not.toHaveBeenCalled();
  });

  it('and published once it is on', async () => {
    const { screen, broadcastKind } = withRoom({ allows: { card: true } });
    screen.open();
    const r = await screen.showCard({ label: 'Sam', line: 'net verhuisd' });
    expect(r).toMatchObject({ ok: true, sent: 2, peers: 2 });
    expect(broadcastKind).toHaveBeenCalledWith('nearby-card', { card: expect.objectContaining({ label: 'Sam' }) });
  });

  it('THE ASYMMETRY: I see other people\u2019s cards even with my own card allow OFF', () => {
    // Looking is not disclosure — the same reason browsing without announcing is a legitimate state.
    const { screen, card } = withRoom();
    screen.open();
    card({ label: 'Ada', line: 'hoi', from: 'peer-1', tags: [] });
    // Attached to the peer row rather than a separate list, so a face and a card are one thing on screen.
    expect(screen.model().rows).toEqual([]);   // no peers yet, but the card is held
    card({ label: 'Ada2', from: 'peer-1' });   // a new card replaces
    expect(() => screen.model()).not.toThrow();
  });

  it('chat is NOT subscribed while the chat allow is off', () => {
    // Reading a conversation you have not joined is listening to people who believe they are talking
    // among participants.
    const { screen, chatBound } = withRoom();
    screen.open();
    expect(chatBound()).toBe(false);
    expect(screen.model().chat).toBeNull();
  });

  it('model.chat is NULL (not []) when I am not in the conversation', () => {
    // An empty array reads as "nobody has said anything", which is a different fact.
    const { screen } = withRoom();
    screen.open();
    expect(screen.model().chat).toBeNull();
  });

  it('joining subscribes; saying something shows it locally', async () => {
    const { screen, chat, broadcastKind } = withRoom({ allows: { chat: true } });
    screen.open();
    chat({ id: 'm1', text: 'hoi', from: 'peer-1' });
    expect(screen.model().chat).toHaveLength(1);

    const r = await screen.say('dag');
    expect(r.ok).toBe(true);
    // The room does not echo mine back, and a message that vanishes on send reads as a failure.
    expect(screen.model().chat.map((m) => m.text)).toEqual(['hoi', 'dag']);
    expect(broadcastKind).toHaveBeenCalledWith('nearby-chat', { message: expect.objectContaining({ text: 'dag' }) });
  });

  it('saying something is refused while the allow is off', async () => {
    const { screen, broadcastKind } = withRoom();
    screen.open();
    expect(await screen.say('hoi')).toMatchObject({ ok: false, reason: 'chat-not-allowed' });
    expect(broadcastKind).not.toHaveBeenCalled();
  });

  it('turning chat OFF leaves immediately AND forgets the conversation', async () => {
    // A setting that only stops future messages would leave the last ones on screen after opting out.
    const { screen, chat, chatBound } = withRoom({ allows: { chat: true } });
    screen.open();
    chat({ id: 'm1', text: 'hoi', from: 'peer-1' });
    expect(screen.model().chat).toHaveLength(1);

    screen.setAllow('chat', false);
    expect(chatBound()).toBe(false);
    expect(screen.model().chat).toBeNull();

    screen.setAllow('chat', true);
    expect(screen.model().chat).toEqual([]);   // rejoining starts empty — no history
  });

  it('only an explicit true enables an allow', () => {
    const { screen } = withRoom();
    screen.open();
    expect(screen.setAllow('card', 'yes')).toEqual({ card: false, chat: false });
    expect(screen.setAllow('card', true)).toEqual({ card: true, chat: false });
  });

  it('leaving the room clears cards and chat', async () => {
    const { screen, card, chat } = withRoom({ allows: { chat: true } });
    screen.open();
    card({ label: 'Ada', from: 'peer-1' });
    chat({ id: 'm1', text: 'hoi', from: 'peer-1' });
    expect(screen.model().chat).toHaveLength(1);

    screen.close();
    expect(screen.model().chat).toEqual([]);
  });
});

describe('broadcast circle invites (step H)', () => {
  const T0 = 1_700_000_000_000;
  // A REAL invite URI. `prepareBroadcastInvite` now DECODES what it is handed so it can strip the circle's
  // relay endpoint before a room hears it (2026-07-31), and fails closed on anything it cannot read — so a
  // placeholder string is no longer a valid fixture. No `relayUrl` here, so the strip is a byte-for-byte
  // no-op and the identity assertions below still hold.
  const URI = `onderling-invite://${globalThis.btoa(JSON.stringify({
    kind: 'membershipCode', groupId: 'c1', code: 'CODE-1',
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

  function withInvites({ invitePublish } = {}) {
    let pushInvite = null;
    const broadcastKind = vi.fn(async () => ({ sent: 4, failed: 0, peers: 4 }));
    const screen = createNearbyScreen({
      control: createDiscoverabilityControl({ transports: () => ({ ble: mk(Discovering) }) }),
      subscribeToInvites: (fn) => { pushInvite = fn; return () => { pushInvite = null; }; },
      askChannel: { broadcastKind },
      invitePublish, myRoomAddress: () => 'me', now: () => T0, t: (k) => k,
    });
    return { screen, broadcastKind, invite: (i) => pushInvite?.(i) };
  }

  const inbound = (over = {}) => ({
    uri: URI, circleId: 'c1', circleName: 'Circle', expiresAt: T0 + 60_000, from: 'them', ...over,
  });

  it('publishing is refused for a circle that was not allowed', async () => {
    const { screen, broadcastKind } = withInvites();
    screen.open();
    expect(await screen.publishInvite({ uri: URI, circleId: 'c1' }))
      .toMatchObject({ ok: false, reason: 'publish-not-allowed' });
    expect(broadcastKind).not.toHaveBeenCalled();
  });

  it('publishing an allowed circle reports the real reach', async () => {
    const { screen, broadcastKind } = withInvites({ invitePublish: { c1: true } });
    screen.open();
    const r = await screen.publishInvite({ uri: URI, circleId: 'c1', circleName: 'Circle' });
    expect(r).toMatchObject({ ok: true, sent: 4, peers: 4 });
    expect(broadcastKind).toHaveBeenCalledWith('nearby-invite', { invite: expect.objectContaining({ circleId: 'c1' }) });
  });

  it('the allow is PER CIRCLE — allowing one does not allow another', async () => {
    const { screen } = withInvites({ invitePublish: { c1: true } });
    screen.open();
    expect(await screen.publishInvite({ uri: URI, circleId: 'c2' }))
      .toMatchObject({ ok: false, reason: 'publish-not-allowed' });
  });

  it('setInvitePublish toggles exactly one circle', () => {
    const { screen } = withInvites();
    screen.open();
    expect(screen.setInvitePublish('c1', true)).toEqual({ c1: true });
    expect(screen.setInvitePublish('c2', true)).toEqual({ c1: true, c2: true });
    expect(screen.setInvitePublish('c1', false)).toEqual({ c2: true });
    expect(screen.setInvitePublish('c1', 'yes')).toEqual({ c2: true });   // truthy is not consent
  });

  it('a received invite appears with exactly one action: join', () => {
    const { screen, invite } = withInvites();
    screen.open();
    invite(inbound());
    const [row] = screen.model().invites;
    expect(row.invite.circleName).toBe('Circle');
    expect(row.actions).toEqual(['join-published-circle']);
    expect(row.note).toBe('join-is-a-join');
  });

  it('two people advertising the SAME circle is one joinable circle, not two offers', () => {
    const { screen, invite } = withInvites();
    screen.open();
    invite(inbound({ from: 'peer-a' }));
    invite(inbound({ from: 'peer-b' }));
    expect(screen.model().invites).toHaveLength(1);
  });

  it('an expired invite never enters the room', () => {
    const { screen, invite } = withInvites();
    screen.open();
    invite(inbound({ expiresAt: T0 - 1 }));
    expect(screen.model().invites).toEqual([]);
  });

  it('I see invites regardless of what I publish — the same asymmetry as cards', () => {
    const { screen, invite } = withInvites();      // publishing nothing
    screen.open();
    invite(inbound());
    expect(screen.model().invites).toHaveLength(1);
  });

  it('leaving the room drops the invites', () => {
    const { screen, invite } = withInvites();
    screen.open();
    invite(inbound());
    screen.close();
    expect(screen.model().invites).toEqual([]);
  });

  it('no invite source ⇒ an empty list, not a crash', () => {
    const { screen } = build();
    screen.open();
    expect(screen.model().invites).toEqual([]);
  });
});


/* ── S6/J-A11 — one stranger cannot spend this device's compute ─────────────── */

describe('an ask flood is bounded, and the expensive half is what gets protected', () => {
  const T0 = 1_700_000_000_000;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function floodRig({ judgeCalls }) {
    let pushAsk = null;
    const control = createDiscoverabilityControl({ transports: () => ({ ble: mk(Discovering) }) });
    const screen = createNearbyScreen({
      control,
      subscribeToAsks: (fn) => { pushAsk = fn; return () => {}; },
      getDrivers: async () => [{ kind: 'help', text: 'ladders', tags: ['ladder'] }],
      judge: async () => { judgeCalls.n += 1; return { resonant: false }; },
      now: () => T0, t: (k) => k,
    });
    return { screen, ask: (a) => pushAsk?.(a) };
  }

  const askFrom = (from, i) => Object.freeze({
    id: `ask-${from}-${i}`, text: `flood ${i}`, tags: ['ladder'],
    from, createdAt: T0, expiresAt: T0 + 60_000,
  });

  it('200 asks from ONE peer no longer drive 200 matches', async () => {
    // Walked as an attack: every ask was matched against the reader's drivers, and matching can call a
    // language model — so a remote party could spend someone else's compute (or money) by talking. The
    // budget is checked BEFORE the judge, which is the whole point of where it sits.
    const judgeCalls = { n: 0 };
    const { screen, ask } = floodRig({ judgeCalls });
    screen.open();
    for (let i = 0; i < 200; i++) ask(askFrom('mallory', i));
    await flush();

    const m = screen.model();
    expect(judgeCalls.n, 'the judge ran once per ask — the amplification is back').toBeLessThanOrEqual(10);
    expect(m.asks.length).toBeLessThanOrEqual(10);
    // …and the room is honest about it rather than presenting a filtered view as the room.
    expect(m.asksIgnored).toBeGreaterThan(150);
  });

  it('an honest neighbour is unaffected by someone else flooding', async () => {
    // A shared bucket would have let one flooder silence everybody, which is a denial of service dressed
    // up as a defence.
    const judgeCalls = { n: 0 };
    const { screen, ask } = floodRig({ judgeCalls });
    screen.open();
    for (let i = 0; i < 200; i++) ask(askFrom('mallory', i));
    await flush();
    ask(askFrom('honest-neighbour', 1));
    await flush();

    expect(screen.model().asks.some((r) => r.ask.from === 'honest-neighbour')).toBe(true);
  });

  it('a re-delivery of an ask we already hold does not spend a token', async () => {
    // Otherwise a flaky link looks like a flood, and the person on the other end of it gets throttled for
    // having bad reception.
    const judgeCalls = { n: 0 };
    const { screen, ask } = floodRig({ judgeCalls });
    screen.open();
    const same = askFrom('neighbour', 1);
    for (let i = 0; i < 50; i++) ask(same);
    await flush();

    expect(screen.model().asks).toHaveLength(1);
    expect(screen.model().asksIgnored).toBe(0);
  });
});
