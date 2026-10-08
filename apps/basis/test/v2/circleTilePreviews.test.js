/**
 * circle tile activity-preview tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTilePreviews, renderSubtitle, bumpSeenAt, countsAsUnread,
} from '../../src/v2/circleTilePreviews.js';

// A conversation line by default — only the human lane counts as unread (see the last describe).
function mkEvent({ id, ts, circleId, payload = {}, actor = null, type = 'chat-message' } = {}) {
  return { id, ts, type, actor, payload: { ...payload, circleId } };
}

describe('renderSubtitle', () => {
  it('returns null when there is nothing renderable', () => {
    expect(renderSubtitle(null)).toBeNull();
    expect(renderSubtitle({})).toBeNull();
    expect(renderSubtitle({ payload: {} })).toBeNull();
    expect(renderSubtitle({ payload: { text: '   ' } })).toBeNull();
  });

  it('prefers actor + text when both available', () => {
    const e = { actor: 'mira', payload: { text: 'brood gehaald ✓' } };
    expect(renderSubtitle(e)).toBe('mira: brood gehaald ✓');
  });

  it('falls back to body/title/message when text is absent', () => {
    expect(renderSubtitle({ payload: { body: 'hello' } })).toBe('hello');
    expect(renderSubtitle({ payload: { title: 'Plant care' } })).toBe('Plant care');
    expect(renderSubtitle({ payload: { message: 'ping' } })).toBe('ping');
  });

  it('reads actor from payload.from / .author / .sender when event.actor is missing', () => {
    expect(renderSubtitle({ payload: { from: 'bob', text: 'hi' } })).toBe('bob: hi');
    expect(renderSubtitle({ payload: { author: 'sam', body: 'hi' } })).toBe('sam: hi');
  });

  it('truncates long bodies with an ellipsis', () => {
    const long = 'a'.repeat(120);
    const out = renderSubtitle({ actor: 'x', payload: { text: long } });
    expect(out.length).toBeLessThanOrEqual(64); // "x: " + 60ish chars
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildTilePreviews', () => {
  const circles = [{ id: 'selwerd' }, { id: 'huisgenoten' }, { id: 'leescircle' }];

  it('seeds an empty preview per known circle when there are no events', () => {
    const map = buildTilePreviews({ events: [], circles });
    expect(map).toEqual({
      selwerd:     { subtitle: null, ts: 0, unread: 0 },
      huisgenoten: { subtitle: null, ts: 0, unread: 0 },
      leescircle:   { subtitle: null, ts: 0, unread: 0 },
    });
  });

  it('picks the newest event per circle for the subtitle + ts', () => {
    const events = [
      mkEvent({ id: 'e1', ts: 100, circleId: 'selwerd',     actor: 'mira',  payload: { text: 'old' } }),
      mkEvent({ id: 'e2', ts: 200, circleId: 'selwerd',     actor: 'pieter', payload: { text: 'new!' } }),
      mkEvent({ id: 'e3', ts: 150, circleId: 'huisgenoten', actor: 'sam',   payload: { text: 'hi' } }),
    ];
    const map = buildTilePreviews({ events, circles });
    expect(map.selwerd.subtitle).toBe('pieter: new!');
    expect(map.selwerd.ts).toBe(200);
    expect(map.huisgenoten.subtitle).toBe('sam: hi');
  });

  it('counts unread = events newer than seenAt[circleId]', () => {
    const events = [
      mkEvent({ id: 'e1', ts: 50,  circleId: 'selwerd' }),
      mkEvent({ id: 'e2', ts: 150, circleId: 'selwerd' }),
      mkEvent({ id: 'e3', ts: 250, circleId: 'selwerd' }),
    ];
    const map = buildTilePreviews({ events, circles, seenAt: { selwerd: 100 } });
    expect(map.selwerd.unread).toBe(2);   // ts > 100
  });

  it('counts everything as unread when seenAt is missing for a circle', () => {
    const events = [
      mkEvent({ id: 'e1', ts: 100, circleId: 'leescircle' }),
      mkEvent({ id: 'e2', ts: 200, circleId: 'leescircle' }),
    ];
    const map = buildTilePreviews({ events, circles });
    expect(map.leescircle.unread).toBe(2);
  });

  it('ignores events for unknown circles', () => {
    const events = [
      mkEvent({ id: 'e1', ts: 100, circleId: 'ghost', payload: { text: 'noise' } }),
    ];
    const map = buildTilePreviews({ events, circles });
    expect(Object.keys(map)).toEqual(['selwerd', 'huisgenoten', 'leescircle']);
    for (const v of Object.values(map)) expect(v.unread).toBe(0);
  });

  it('ignores events without a circleId entirely', () => {
    const events = [
      { id: 'e1', ts: 100, payload: { text: 'global' } },
    ];
    const map = buildTilePreviews({ events, circles });
    for (const v of Object.values(map)) expect(v.unread).toBe(0);
  });

  it('handles an event with no renderable payload (subtitle stays null, unread still counts)', () => {
    const events = [
      mkEvent({ id: 'e1', ts: 100, circleId: 'selwerd' }),  // no text/body/etc
    ];
    const map = buildTilePreviews({ events, circles });
    expect(map.selwerd.subtitle).toBeNull();
    expect(map.selwerd.ts).toBe(100);
    expect(map.selwerd.unread).toBe(1);
  });
});

describe('bumpSeenAt', () => {
  it('returns a new object with the supplied circleId bumped', () => {
    const before = { a: 1, b: 2 };
    const after = bumpSeenAt(before, 'a', 500);
    expect(after).not.toBe(before);
    expect(after).toEqual({ a: 500, b: 2 });
    expect(before.a).toBe(1);                // didn't mutate input
  });

  it('is a no-op when no circleId is supplied', () => {
    const before = { a: 1 };
    expect(bumpSeenAt(before, null)).toBe(before);
  });

  it('seeds an empty seenAt when the input is null', () => {
    const after = bumpSeenAt(null, 'a', 42);
    expect(after).toEqual({ a: 42 });
  });
});

/**
 * A circle you had just made showed "6 unread" (exploratory walk, 2026-10-08): every event counted — your own
 * sends, the roster, the rules, the join — and whatever happened while you were INSIDE the circle was newer than
 * the mark set on opening it. Unread now means: on the HUMAN lane (the entry-kinds dictionary decides, never a
 * hand list) AND not mine; the shells bump seenAt on leaving as well as on opening.
 */
describe('buildTilePreviews — unread is what OTHERS said', () => {
  const circles = [{ id: 'club' }];
  const ME = 'me-pub';
  it('my own send is never unread', () => {
    const events = [{ id: 'a', ts: 10, type: 'chat-message', circleId: 'club', actor: ME, payload: { text: 'hoi' } }];
    expect(buildTilePreviews({ events, circles, myRefs: [ME] }).club.unread).toBe(0);
  });
  it("someone else's message is one", () => {
    const events = [{ id: 'b', ts: 10, type: 'chat-message', circleId: 'club', actor: 'bea-pub', payload: { text: 'dank!' } }];
    expect(buildTilePreviews({ events, circles, myRefs: [ME] }).club.unread).toBe(1);
  });
  it('roster / rules / system entries are never unread', () => {
    const events = [
      { id: 'r', ts: 10, type: 'roster-updated', circleId: 'club', actor: 'bea-pub' },
      { id: 's', ts: 11, type: 'group-rules', circleId: 'club', actor: 'bea-pub' },
      { id: 'u', ts: 12, type: 'some-unlisted-kind', circleId: 'club', actor: 'bea-pub' },
    ];
    expect(buildTilePreviews({ events, circles, myRefs: [ME] }).club.unread).toBe(0);
  });
  it('leave and return: nothing new since leaving → none', () => {
    const events = [{ id: 'b', ts: 10, type: 'chat-message', circleId: 'club', actor: 'bea-pub', payload: { text: 'dank!' } }];
    const seenAt = bumpSeenAt({}, 'club', 20);   // left the circle at 20, after Bea's line
    expect(buildTilePreviews({ events, circles, seenAt, myRefs: [ME] }).club.unread).toBe(0);
  });
  it('countsAsUnread is the one decision, exported for both shells', () => {
    expect(countsAsUnread({ type: 'chat-message', actor: 'bea-pub' }, { myRefs: [ME] })).toBe(true);
    expect(countsAsUnread({ type: 'chat-message', actor: ME }, { myRefs: [ME] })).toBe(false);
    expect(countsAsUnread({ type: 'roster-updated', actor: 'bea-pub' }, { myRefs: [ME] })).toBe(false);
  });
});
