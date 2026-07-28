/**
 * Carrying asks across the room (Nearby step F, transport half).
 *
 * This is the first thing in Nearby that accepts a payload from a stranger on the same café Wi-Fi — no
 * invite, no roster, no prior relationship. So most of these tests are hostile-input tests, and the one
 * that matters most is `from`: a sender must not be able to point answers at a third party.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAskChannel, ASK_MESSAGE, ANSWER_MESSAGE, ASK_MAX_TAGS } from '../../src/v2/nearbyAskChannel.js';
import { ASK_MAX_TEXT, ASK_MAX_TTL_MS } from '../../src/v2/nearbyAsks.js';

const T0 = 1_700_000_000_000;
const now = () => T0;

function build({ peers = [{ pubKey: 'a' }, { pubKey: 'b' }], sendTo = vi.fn(async () => {}) } = {}) {
  const ch = createAskChannel({ listPeers: () => peers, sendTo, now });
  return { ch, sendTo };
}

const liveAsk = (over = {}) => ({
  id: 'ask-1', text: 'anyone got a bike pump?', tags: ['fiets'],
  createdAt: T0, expiresAt: T0 + 60_000, from: 'them', ...over,
});

const inbound = (ask) => ({ subtype: ASK_MESSAGE, ask });

describe('broadcasting', () => {
  it('fans out to every visible peer — there is no room server', async () => {
    const { ch, sendTo } = build();
    const r = await ch.broadcast(liveAsk());
    expect(r).toEqual({ sent: 2, failed: 0, peers: 2 });
    expect(sendTo).toHaveBeenCalledWith('a', { subtype: ASK_MESSAGE, ask: expect.any(Object) });
  });

  it('one unreachable peer does not abort the rest', async () => {
    // Reaching most of a café is the normal outcome, not an error state.
    const sendTo = vi.fn(async (addr) => { if (addr === 'a') throw new Error('gone'); });
    const { ch } = build({ sendTo });
    expect(await ch.broadcast(liveAsk())).toEqual({ sent: 1, failed: 1, peers: 2 });
  });

  it('refuses to broadcast an expired ask', async () => {
    const { ch, sendTo } = build();
    expect(await ch.broadcast(liveAsk({ expiresAt: T0 - 1 }))).toEqual({ sent: 0, failed: 0, peers: 0 });
    expect(sendTo).not.toHaveBeenCalled();
  });

  it('an empty room is not an error', async () => {
    const { ch } = build({ peers: [] });
    expect(await ch.broadcast(liveAsk())).toEqual({ sent: 0, failed: 0, peers: 0 });
  });
});

describe('answering is point-to-point', () => {
  it('goes to the asker ALONE, never the room', async () => {
    // Broadcasting an answer would tell everyone present who can fix a bike.
    const { ch, sendTo } = build();
    const r = await ch.sendAnswer({ askId: 'ask-1', text: 'ik heb er een' }, 'them');
    expect(r).toEqual({ ok: true });
    expect(sendTo).toHaveBeenCalledTimes(1);
    expect(sendTo).toHaveBeenCalledWith('them', { subtype: ANSWER_MESSAGE, answer: expect.any(Object) });
  });

  it('refuses with no recipient', async () => {
    const { ch, sendTo } = build();
    expect(await ch.sendAnswer({ askId: 'x', text: 'y' }, null)).toMatchObject({ ok: false });
    expect(sendTo).not.toHaveBeenCalled();
  });

  it('reports a send failure rather than claiming success', async () => {
    const { ch } = build({ sendTo: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await ch.sendAnswer({ askId: 'x', text: 'y' }, 'them')).toMatchObject({ ok: false, reason: 'offline' });
  });
});

describe('an inbound ask is untrusted', () => {
  it('THE ONE THAT MATTERS: `from` comes from the WIRE, never the payload', () => {
    // Otherwise a sender names someone else's address and every answer opens a channel to that third party.
    const { ch } = build();
    const ask = ch.receiveAsk(inbound(liveAsk({ from: 'victim-address' })), 'actual-sender');
    expect(ask.from).toBe('actual-sender');
  });

  it('rebuilds the ask — smuggled fields do not survive', () => {
    const { ch } = build();
    const ask = ch.receiveAsk(inbound(liveAsk({
      isAdmin: true, driverSignature: { tags: ['x'] }, __proto__: { evil: 1 },
    })), 'them');
    expect(Object.keys(ask).sort()).toEqual(['createdAt', 'expiresAt', 'from', 'id', 'tags', 'text']);
    expect(ask.isAdmin).toBeUndefined();
  });

  it('caps `expiresAt` against OUR clock — no ask pins itself in the room forever', () => {
    const { ch } = build();
    const ask = ch.receiveAsk(inbound(liveAsk({ expiresAt: Number.MAX_SAFE_INTEGER })), 'them');
    expect(ask.expiresAt).toBe(T0 + ASK_MAX_TTL_MS);
  });

  it('drops an ask that is already dead, or dishonestly dated', () => {
    const { ch } = build();
    expect(ch.receiveAsk(inbound(liveAsk({ expiresAt: T0 - 1 })), 'them')).toBeNull();
    expect(ch.receiveAsk(inbound(liveAsk({ expiresAt: Infinity })), 'them')).toBeNull();
    expect(ch.receiveAsk(inbound(liveAsk({ expiresAt: 'soon' })), 'them')).toBeNull();
  });

  it('clamps text and tags so a peer cannot flood every screen', () => {
    const { ch } = build();
    expect(ch.receiveAsk(inbound(liveAsk({ text: 'x'.repeat(ASK_MAX_TEXT + 1) })), 'them')).toBeNull();

    const many = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(ch.receiveAsk(inbound(liveAsk({ tags: many })), 'them').tags).toHaveLength(ASK_MAX_TAGS);
  });

  it('normalizes and dedupes tags, and drops junk', () => {
    const { ch } = build();
    const ask = ch.receiveAsk(inbound(liveAsk({ tags: ['Fiets', ' fiets ', '', null, 'x'.repeat(100)] })), 'them');
    expect(ask.tags).toEqual(['fiets']);
  });

  it('rejects anything without a usable id or text', () => {
    const { ch } = build();
    expect(ch.receiveAsk(inbound(liveAsk({ id: '' })), 'them')).toBeNull();
    expect(ch.receiveAsk(inbound(liveAsk({ id: 'x'.repeat(200) })), 'them')).toBeNull();
    expect(ch.receiveAsk(inbound(liveAsk({ text: '   ' })), 'them')).toBeNull();
  });

  it('ignores messages that are not asks at all', () => {
    const { ch } = build();
    expect(ch.receiveAsk({ subtype: 'kring-chat-message', ask: liveAsk() }, 'them')).toBeNull();
    expect(ch.receiveAsk(null, 'them')).toBeNull();
    expect(ch.receiveAsk(inbound('not-an-object'), 'them')).toBeNull();
  });

  it('the result is frozen', () => {
    const { ch } = build();
    const ask = ch.receiveAsk(inbound(liveAsk()), 'them');
    expect(Object.isFrozen(ask)).toBe(true);
    expect(Object.isFrozen(ask.tags)).toBe(true);
  });
});

describe('an inbound answer is untrusted too', () => {
  it('takes `from` from the wire and opens the channel with THAT sender', () => {
    const { ch } = build();
    const a = ch.receiveAnswer({ subtype: ANSWER_MESSAGE, answer: { askId: 'ask-1', text: 'ja', from: 'someone-else' } }, 'real');
    expect(a.from).toBe('real');
    expect(a.opensDirectChannel).toBe(true);
  });

  it('rejects a malformed answer', () => {
    const { ch } = build();
    expect(ch.receiveAnswer({ subtype: ANSWER_MESSAGE, answer: { askId: 'x' } }, 'them')).toBeNull();
    expect(ch.receiveAnswer({ subtype: ANSWER_MESSAGE, answer: { text: 'hi' } }, 'them')).toBeNull();
    expect(ch.receiveAnswer({ subtype: ASK_MESSAGE, answer: { askId: 'x', text: 'y' } }, 'them')).toBeNull();
  });

  it('carries no match details — an answer says who and what, never why', () => {
    const { ch } = build();
    const a = ch.receiveAnswer({
      subtype: ANSWER_MESSAGE,
      answer: { askId: 'ask-1', text: 'ja', matches: [{ tags: ['fiets'] }] },
    }, 'them');
    expect(Object.keys(a).sort()).toEqual(['askId', 'from', 'opensDirectChannel', 'receivedAt', 'text']);
  });
});
