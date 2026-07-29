/**
 * Cards and room chat (Nearby step G).
 *
 * A card is structurally the "badge listing what you own" that §4 rejects, so the tests carry the
 * distinction the design rests on: the rejected thing was AUTOMATIC broadcast of an inventory so matching
 * could happen; a card is authored, opt-in, and visible to its author. That difference lives in the
 * defaults and in the absence of any derive-from-profile path — both pinned here.
 */
import { describe, it, expect, vi } from 'vitest';
import * as room from '../../src/v2/nearbyRoom.js';
import {
  roomAllows, createCard, receiveCard, createChatMessage, receiveChatMessage, createRoomChat,
  CARD_MESSAGE, CHAT_MESSAGE, CARD_MAX_LABEL, CARD_MAX_LINE, CARD_MAX_TAGS, CHAT_MAX_TEXT,
} from '../../src/v2/nearbyRoom.js';

const T0 = 1_700_000_000_000;
const now = () => T0;

describe('the per-device allows', () => {
  it('BOTH default OFF — walking into a room must not start publishing for you', () => {
    expect(roomAllows()).toEqual({ card: false, chat: false });
    expect(roomAllows({})).toEqual({ card: false, chat: false });
    expect(roomAllows(null)).toEqual({ card: false, chat: false });
  });

  it('only an explicit true enables one — a truthy value is not consent', () => {
    expect(roomAllows({ card: 'yes', chat: 1 })).toEqual({ card: false, chat: false });
    expect(roomAllows({ card: true, chat: false })).toEqual({ card: true, chat: false });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(roomAllows({ card: true }))).toBe(true);
  });
});

describe('a card is AUTHORED, never derived', () => {
  it('THE RULE: there is no way to build a card from a stored profile', () => {
    // The moment a card can be generated from your offerings/drivers, "authored, never derived" is one
    // convenience function away from gone — and the automatic-inventory design §4 rejects is back under a
    // friendlier name. This asserts the absence deliberately.
    const exported = Object.keys(room);
    expect(exported.some((k) => /fromProfile|fromDrivers|fromOfferings|autoCard/i.test(k))).toBe(false);
  });

  it('carries only what was typed', () => {
    const { card } = createCard({ label: 'Sam', line: 'net verhuisd', tags: ['Fiets', 'fiets'], from: 'me', now });
    expect(card).toMatchObject({ label: 'Sam', line: 'net verhuisd', tags: ['fiets'], from: 'me' });
    expect(Object.isFrozen(card)).toBe(true);
  });

  it('needs a face; the rest is optional', () => {
    expect(createCard({ label: '  ' })).toMatchObject({ ok: false, reason: 'empty-card' });
    expect(createCard({ label: 'Sam', now }).card.line).toBe('');
  });

  it('caps label, line and tag count', () => {
    expect(createCard({ label: 'x'.repeat(CARD_MAX_LABEL + 1) })).toMatchObject({ reason: 'label-too-long' });
    expect(createCard({ label: 'Sam', line: 'x'.repeat(CARD_MAX_LINE + 1) })).toMatchObject({ reason: 'line-too-long' });
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(createCard({ label: 'Sam', tags: many, now }).card.tags).toHaveLength(CARD_MAX_TAGS);
  });
});

describe('an inbound card is untrusted', () => {
  const inbound = (card) => ({ subtype: CARD_MESSAGE, card });

  it('`from` comes from the WIRE — a card must not name someone else as its author', () => {
    const c = receiveCard(inbound({ label: 'Sam', from: 'victim' }), 'actual-sender', now);
    expect(c.from).toBe('actual-sender');
  });

  it('is rebuilt — smuggled fields do not survive', () => {
    const c = receiveCard(inbound({ label: 'Sam', line: 'hoi', verified: true, admin: true }), 'them', now);
    expect(Object.keys(c).sort()).toEqual(['from', 'label', 'line', 'receivedAt', 'tags']);
    expect(c.verified).toBeUndefined();
  });

  it('REFUSES a long line rather than clamping it — a shortened card is invisibly wrong', () => {
    // This test used to assert the opposite, on the reasoning that "a card is not hostile just for being
    // wordy". That reasoning does not survive looking at the send side: `createCard` REFUSES
    // `line-too-long`, so a wordy neighbour is stopped at their own keyboard, with a message they can act
    // on by shortening it. Nothing an honest client emits can arrive over-length.
    //
    // What clamping did instead was accept a 5 000-character line as a 140-character card that LOOKED
    // like an ordinary card and was not what its author sent (S6/J-A14). A refused card is visibly
    // absent; a truncated one is invisibly wrong, and the reader has no way to know.
    expect(receiveCard(inbound({ label: 'Sam', line: 'x'.repeat(CARD_MAX_LINE + 1) }), 'them', now)).toBeNull();
    // …and one that fits is untouched, so the rule is a ceiling and not a new obstacle.
    const ok = receiveCard(inbound({ label: 'Sam', line: 'x'.repeat(CARD_MAX_LINE) }), 'them', now);
    expect(ok.line).toHaveLength(CARD_MAX_LINE);
  });

  it('rejects a card with no usable face, or the wrong message kind', () => {
    expect(receiveCard(inbound({ label: '' }), 'them', now)).toBeNull();
    expect(receiveCard(inbound({ label: 'x'.repeat(CARD_MAX_LABEL + 1) }), 'them', now)).toBeNull();
    expect(receiveCard({ subtype: CHAT_MESSAGE, card: { label: 'Sam' } }, 'them', now)).toBeNull();
    expect(receiveCard(null, 'them', now)).toBeNull();
  });
});

describe('chat is gated by the allow, in the LOGIC not the UI', () => {
  it('refuses to compose when chat is not allowed', () => {
    // "Did the button render" is the wrong place to enforce a disclosure rule — a stale prop or a second
    // call site would each bypass it.
    expect(createChatMessage({ text: 'hoi', allows: roomAllows(), now }))
      .toMatchObject({ ok: false, reason: 'chat-not-allowed' });
  });

  it('composes once allowed', () => {
    const r = createChatMessage({ text: '  hoi  ', from: 'me', allows: roomAllows({ chat: true }), now });
    expect(r.ok).toBe(true);
    expect(r.message).toMatchObject({ text: 'hoi', from: 'me' });
    expect(Object.isFrozen(r.message)).toBe(true);
  });

  it('refuses empty and oversized messages', () => {
    const allows = roomAllows({ chat: true });
    expect(createChatMessage({ text: '   ', allows, now })).toMatchObject({ reason: 'empty-message' });
    expect(createChatMessage({ text: 'x'.repeat(CHAT_MAX_TEXT + 1), allows, now }))
      .toMatchObject({ reason: 'message-too-long' });
  });

  it('an inbound message takes `from` from the wire and is rebuilt', () => {
    const m = receiveChatMessage(
      { subtype: CHAT_MESSAGE, message: { id: 'm1', text: 'hoi', from: 'someone-else', admin: true } },
      'real', now,
    );
    expect(m.from).toBe('real');
    expect(Object.keys(m).sort()).toEqual(['from', 'id', 'receivedAt', 'text']);
  });

  it('rejects a malformed inbound message', () => {
    expect(receiveChatMessage({ subtype: CHAT_MESSAGE, message: { text: 'hi' } }, 'them', now)).toBeNull();
    expect(receiveChatMessage({ subtype: CHAT_MESSAGE, message: { id: 'm1', text: '' } }, 'them', now)).toBeNull();
    expect(receiveChatMessage({ subtype: CARD_MESSAGE, message: { id: 'm1', text: 'hi' } }, 'them', now)).toBeNull();
  });
});

describe('the room chat is ephemeral', () => {
  const msg = (id, text = 'hoi') => ({ id, text, from: 'them', receivedAt: T0 });

  it('NO HISTORY: someone who arrives later sees an empty room', () => {
    // Replaying what was said before you arrived turns an in-the-moment conversation into a record — and a
    // record of a room is a record of who was in it.
    const chat = createRoomChat();
    chat.add(msg('a')); chat.add(msg('b'));
    expect(chat.list()).toHaveLength(2);

    chat.clear();                       // leaving
    expect(createRoomChat().list()).toEqual([]);
    expect(chat.list()).toEqual([]);    // and re-entering starts empty
  });

  it('a re-delivery is not a second message', () => {
    const chat = createRoomChat();
    chat.add(msg('a')); chat.add(msg('a'));
    expect(chat.list()).toHaveLength(1);
  });

  it('keeps only the most recent, so one peer cannot fill the device', () => {
    const chat = createRoomChat({ max: 3 });
    for (let i = 0; i < 10; i += 1) chat.add(msg(`m${i}`));
    expect(chat.list().map((m) => m.id)).toEqual(['m7', 'm8', 'm9']);
  });

  it('notifies watchers, and a throwing one does not stop the rest', () => {
    const chat = createRoomChat();
    const good = vi.fn();
    chat.subscribe(() => { throw new Error('bad render'); });
    const off = chat.subscribe(good);

    chat.add(msg('a'));
    expect(good).toHaveBeenCalled();

    off();
    good.mockClear();
    chat.add(msg('b'));
    expect(good).not.toHaveBeenCalled();
  });

  it('ignores a message with no id', () => {
    const chat = createRoomChat();
    chat.add({ text: 'hoi' });
    expect(chat.list()).toEqual([]);
  });
});
