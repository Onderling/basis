/**
 * Asks and answers in the vicinity room (Nearby step F).
 *
 * The whole design is one inversion — **broadcast the question, never the inventory** — so most of these
 * tests are about what does NOT travel:
 *
 *   • an ask carries a need, never what the asker has;
 *   • matching runs on the responder's device and the drivers never leave it;
 *   • the match names shared TAGS, never the authored driver text;
 *   • answering is the only disclosure, and it is a deliberate act.
 *
 * Plus expiry, because a stale ask that still matches invites an answer nobody is waiting for.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAsk, isAskLive, evaluateIncomingAsk, askActions, answerAsk,
  ASK_DEFAULT_TTL_MS, ASK_MAX_TTL_MS, ASK_MAX_TEXT,
} from '../../src/v2/nearbyAsks.js';

const T0 = 1_700_000_000_000;
const at = (ms) => () => T0 + ms;

const ask = (over = {}) => createAsk({
  text: 'anyone got a bike pump?', tags: ['fiets', 'gereedschap'],
  from: 'room-addr-1', now: at(0), id: () => 'ask-1', ...over,
}).ask;

/**
 * A profile property map holding DRIVER values — the shape `driversFromProperties` keeps.
 * One driver per tag, so a test can say exactly which one matched.
 */
const drivers = (tags) => async () => Object.fromEntries(
  tags.map((tag) => [tag, { kind: 'offering', text: `ik kan ${tag}`, tags: [tag] }]),
);

describe('the ask object — a need, not an inventory', () => {
  it('carries the question, its tags, and nothing about what the asker HAS', () => {
    const a = ask();
    expect(a.text).toBe('anyone got a bike pump?');
    expect(a.tags).toEqual(['fiets', 'gereedschap']);
    // The failure this guards: quietly adding the asker's own skills/drivers "so matching works better"
    // would recreate the broadcast-inventory design the whole section rejects.
    expect(Object.keys(a).sort()).toEqual(
      ['createdAt', 'expiresAt', 'from', 'id', 'tags', 'text'],
    );
  });

  it('is frozen — a caller cannot bolt an inventory onto it after the fact', () => {
    const a = ask();
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.tags)).toBe(true);
  });

  it('normalizes tags coarsely: lowercased, trimmed, deduped', () => {
    // Coarse on purpose — a precise tag is an identifier.
    expect(ask({ tags: ['Fiets', ' fiets ', 'GEREEDSCHAP', ''] }).tags)
      .toEqual(['fiets', 'gereedschap']);
  });

  it('refuses an empty or oversized ask', () => {
    expect(createAsk({ text: '   ' })).toMatchObject({ ok: false, reason: 'empty-ask' });
    expect(createAsk({ text: 'x'.repeat(ASK_MAX_TEXT + 1) })).toMatchObject({ ok: false, reason: 'ask-too-long' });
  });

  it('is transient by construction, and the ttl is clamped', () => {
    expect(ask().expiresAt - ask().createdAt).toBe(ASK_DEFAULT_TTL_MS);
    expect(ask({ ttlMs: 999 }).expiresAt - T0).toBe(60_000);                 // floor
    expect(ask({ ttlMs: 99 * 60 * 60_000 }).expiresAt - T0).toBe(ASK_MAX_TTL_MS);  // ceiling
  });
});

describe('matching runs on the RESPONDER device', () => {
  it('resonates on a shared tag and names the tags, not my drivers', async () => {
    const r = await evaluateIncomingAsk({
      ask: ask(), getDrivers: drivers(['fiets', 'repareren']), now: at(0),
    });
    expect(r.resonant).toBe(true);
    expect(r.reason).toContain('fiets');
    // The private half must not surface: 'repareren' is mine and unmatched, so it must not appear.
    expect(r.reason).not.toContain('repareren');
  });

  it('the ask NEVER receives my drivers — the matcher reads them, the room does not', async () => {
    const a = ask();
    const before = JSON.stringify(a);
    const getDrivers = vi.fn(drivers(['fiets']));
    await evaluateIncomingAsk({ ask: a, getDrivers, now: at(0) });
    expect(getDrivers).toHaveBeenCalled();          // read locally…
    expect(JSON.stringify(a)).toBe(before);         // …and the ask is untouched
  });

  it('no overlap ⇒ no signal at all', async () => {
    const r = await evaluateIncomingAsk({ ask: ask(), getDrivers: drivers(['tuinieren']), now: at(0) });
    expect(r).toMatchObject({ resonant: false, reason: null, matches: [] });
  });

  it('no drivers ⇒ no match, and no crash', async () => {
    const r = await evaluateIncomingAsk({ ask: ask(), getDrivers: async () => ({}), now: at(0) });
    expect(r.resonant).toBe(false);
  });

  it('a matcher failure is silence, not an exception', async () => {
    const r = await evaluateIncomingAsk({
      ask: ask(), getDrivers: async () => { throw new Error('vault locked'); }, now: at(0),
    });
    expect(r.resonant).toBe(false);
  });
});

describe('expiry', () => {
  it('a live ask matches; the same ask after expiry does not', async () => {
    const a = ask();
    expect(isAskLive(a, at(0))).toBe(true);
    expect(isAskLive(a, at(ASK_DEFAULT_TTL_MS + 1))).toBe(false);

    const live = await evaluateIncomingAsk({ ask: a, getDrivers: drivers(['fiets']), now: at(0) });
    expect(live.resonant).toBe(true);

    // Matching a need that has passed invites an answer nobody is waiting for.
    const stale = await evaluateIncomingAsk({
      ask: a, getDrivers: drivers(['fiets']), now: at(ASK_DEFAULT_TTL_MS + 1),
    });
    expect(stale).toMatchObject({ resonant: false, expired: true });
  });

  it('an expired ask offers no actions', () => {
    expect(askActions(ask(), { now: at(ASK_DEFAULT_TTL_MS + 1) }))
      .toEqual({ actions: [], note: 'ask-expired' });
  });

  it('a malformed ask is never live', () => {
    expect(isAskLive(null)).toBe(false);
    expect(isAskLive({})).toBe(false);
  });
});

describe('answering is the disclosure', () => {
  it('offers answer + dismiss on a live ask, and flags that replying reveals you', () => {
    expect(askActions(ask(), { resonant: true, now: at(0) })).toEqual({
      actions: ['answer-ask', 'dismiss-ask'],
      note: 'answer-is-disclosure',
    });
  });

  it('NOTHING notifies the asker that someone nearby matched', () => {
    // The tempting feature — "3 people near you can help" — discloses on the responder's behalf, which is
    // exactly what the design forbids. There is no action for it, and this pins that.
    const { actions } = askActions(ask(), { resonant: true, now: at(0) });
    expect(actions).not.toContain('notify-asker');
    expect(actions.every((a) => ['answer-ask', 'dismiss-ask'].includes(a))).toBe(true);
  });

  it('an answer carries the responder\'s words, NOT the match details', () => {
    const { answer } = answerAsk({ ask: ask(), text: 'ik heb er een', from: 'room-addr-2', now: at(10) });
    // Handing back "we matched on fiets, repareren" would disclose the responder's drivers by the back door.
    expect(Object.keys(answer).sort()).toEqual(
      ['askId', 'createdAt', 'from', 'opensDirectChannel', 'text'],
    );
    expect(JSON.stringify(answer)).not.toContain('fiets');
  });

  it('answering opens the pairwise channel — rung 3 of the ladder', () => {
    const { answer } = answerAsk({ ask: ask(), text: 'yes', now: at(0) });
    expect(answer.opensDirectChannel).toBe(true);
  });

  it('cannot answer an expired ask', () => {
    expect(answerAsk({ ask: ask(), text: 'yes', now: at(ASK_DEFAULT_TTL_MS + 1) }))
      .toMatchObject({ ok: false, reason: 'ask-expired' });
  });

  it('refuses an empty or oversized answer', () => {
    expect(answerAsk({ ask: ask(), text: '  ', now: at(0) })).toMatchObject({ ok: false, reason: 'empty-answer' });
    expect(answerAsk({ ask: ask(), text: 'x'.repeat(ASK_MAX_TEXT + 1), now: at(0) }))
      .toMatchObject({ ok: false, reason: 'answer-too-long' });
  });

  it('refuses an answer with no ask', () => {
    expect(answerAsk({ text: 'yes' })).toMatchObject({ ok: false, reason: 'no-ask' });
  });
});
