/**
 * Nearby's Conversation tab is one stream in the order things arrived (oldest first, like a chat): the room chat's
 * lines, and between them a card for each question someone here asked and each circle offered here. And each tab says
 * how much is new since the person last looked at it. Both decided once in shared code, so web and the phone agree.
 */
import { describe, it, expect } from 'vitest';
import { nearbyStream, nearbyTabNews } from '../../src/v2/nearbyStream.js';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';
import circleNl from '../../src/locales/circle.nl.json' with { type: 'json' };
import circleEn from '../../src/locales/circle.en.json' with { type: 'json' };

const text = (bundle, key) => key.split('.').slice(1).reduce((o, k) => o?.[k], bundle)?.text;

const room = {
  chat: [
    { id: 'm1', text: 'hoi', who: 'Ans', at: 100, mine: false },
    { id: 'm2', text: 'hallo', who: 'Jij', at: 300, mine: true },
    { id: 'm3', text: 'wie heeft een pomp?', who: 'Bob', at: 500, mine: false },
  ],
  asks: [
    { ask: { id: 'a1', text: 'pomp?', createdAt: 9_999 }, receivedAt: 400, who: 'Bob' },
    { ask: { id: 'a0', text: 'ladder?', createdAt: 50 }, receivedAt: 200, who: 'Cor' },
  ],
  myAsks: [{ ask: { id: 'mine1', text: 'soep?' }, heard: 2, answers: [{ from: 'p9', text: 'ja', receivedAt: 450 }] }],
  invites: [{ invite: { circleId: 'c1', circleName: 'Buurtmoestuin', receivedAt: 250 }, who: 'Dirk' }],
  rows: [],
};

describe('nearbyStream — one stream, by arrival', () => {
  it('chat lines, others\' questions and offered circles, oldest first, each with its arrival time', () => {
    const items = nearbyStream(room);
    expect(items.map((i) => [i.kind, i.at])).toEqual([
      ['line', 100], ['ask', 200], ['invite', 250], ['line', 300], ['ask', 400], ['line', 500],
    ]);
    expect(items.map((i) => i.key)).toEqual(['line:m1', 'ask:a0', 'invite:c1', 'line:m2', 'ask:a1', 'line:m3']);
  });

  it('an ask is placed by when THIS device received it, not by the time its sender claims', () => {
    const a1 = nearbyStream(room).find((i) => i.key === 'ask:a1');
    expect(a1.at).toBe(400);
    expect(a1.entry.ask.text).toBe('pomp?');
  });

  it('my own questions are not cards in the stream (they live in Questions with their answers)', () => {
    expect(nearbyStream(room).some((i) => i.key === 'ask:mine1')).toBe(false);
  });

  it('not in the chat: no stream at all (the tab says how to join instead)', () => {
    expect(nearbyStream({ ...room, chat: null })).toEqual([]);
  });

  it('in the chat, nobody said anything, nothing asked: an empty stream', () => {
    expect(nearbyStream({ chat: [] })).toEqual([]);
    expect(nearbyStream(null)).toEqual([]);
  });
});

describe('nearbyTabNews — what is new on each tab', () => {
  it('never looked: everything that arrived counts, except my own chat lines', () => {
    const { counts } = nearbyTabNews(room, {});
    // conversation: m1, m3 (not my m2), a0, a1, c1 = 5; questions: a0, a1, c1, the answer to my ask = 4
    expect(counts).toEqual({ conversation: 5, questions: 4 });
  });

  it('counts only what arrived after the tab was last seen', () => {
    const { counts } = nearbyTabNews(room, { conversation: 300, questions: 400 });
    expect(counts).toEqual({ conversation: 2, questions: 1 });
  });

  it('gives the latest arrival per tab, which is what a shell marks as seen when the tab is open', () => {
    const { latest } = nearbyTabNews(room, {});
    expect(latest).toEqual({ conversation: 500, questions: 450 });
    const after = nearbyTabNews(room, latest);
    expect(after.counts).toEqual({ conversation: 0, questions: 0 });
  });

  it('not in the chat: the Conversation tab counts nothing', () => {
    expect(nearbyTabNews({ ...room, chat: null }, {}).counts.conversation).toBe(0);
  });

  it('the tab label with a count, in both languages', () => {
    expect(text(circleNl, 'circle.nearbyScreen.tab_with_new')).toBe('{{label}} · {{count}}');
    expect(text(circleEn, 'circle.nearbyScreen.tab_with_new')).toBe('{{label}} · {{count}}');
  });

  it('the cards are told apart from chat lines by their own words, in both languages', () => {
    for (const k of ['stream_ask_from', 'stream_invite_from']) {
      expect(text(circleNl, `circle.nearbyScreen.${k}`)).toMatch(/\{\{name\}\}/);
      expect(text(circleEn, `circle.nearbyScreen.${k}`)).toMatch(/\{\{name\}\}/);
    }
  });
});

describe('the controller gives each kind its arrival time and who', () => {
  const T0 = 1_700_000_000_000;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('a chat line carries `at`; an ask and an offered circle carry when they arrived here and who sent them', async () => {
    let clock = T0;
    let pushAsk = null; let pushInvite = null; let pushChat = null;
    const screen = createNearbyScreen({
      subscribeToAsks: (fn) => { pushAsk = fn; return () => {}; },
      subscribeToInvites: (fn) => { pushInvite = fn; return () => {}; },
      subscribeToChat: (fn) => { pushChat = fn; return () => {}; },
      allows: { chat: true },
      myRoomAddress: () => 'me', now: () => clock, t: (k) => k,
    });
    screen.open();
    clock = T0 + 1000;
    // the sender claims a time far in the future: it must not decide where the card lands
    pushAsk({ id: 'ask-1', text: 'pomp?', tags: [], from: 'abcdef123456', createdAt: T0 + 9_000_000, expiresAt: T0 + 600_000 });
    await flush();
    clock = T0 + 2000;
    pushInvite({ uri: 'onderling-invite://x', circleId: 'c1', circleName: 'Tuin', expiresAt: T0 + 600_000, from: 'abcdef123456', receivedAt: T0 + 2000 });
    pushChat({ id: 'm1', text: 'hoi', from: 'abcdef123456', receivedAt: T0 + 3000 });
    await flush();

    const m = screen.model();
    expect(m.chat[0].at).toBe(T0 + 3000);
    expect(m.asks[0]).toMatchObject({ receivedAt: T0 + 1000, who: 'peer-abcdef' });
    expect(m.invites[0]).toMatchObject({ who: 'peer-abcdef' });
    expect(nearbyStream(m).map((i) => i.kind)).toEqual(['ask', 'invite', 'line']);
  });
});
