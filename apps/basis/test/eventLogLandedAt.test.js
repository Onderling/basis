/**
 * The log stamps when THIS device first held an entry (`landedAt`), beside the sender's `ts`, which stays.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';

describe('landedAt: this device\'s clock at the first append of an id', () => {
  it('a line said at 10:00 and delivered at 14:00 keeps ts 10:00 and lands at 14:00', () => {
    let clock = Date.UTC(2026, 10, 9, 14, 0);
    const log = new EventLog({ now: () => clock });
    const said = Date.UTC(2026, 10, 9, 10, 0);
    const e = log.append({ id: 'm1', ts: said, type: 'chat-message', payload: { text: 'hoi' } });
    expect(e.ts).toBe(said);
    expect(e.landedAt).toBe(clock);
  });
  it('a re-append of the same id keeps the first landing; a caller cannot supply one', () => {
    let clock = 1_000_000;
    const log = new EventLog({ now: () => clock });
    log.append({ id: 'm1', ts: 5, type: 'chat-message', landedAt: 1 });
    expect(log.query()[0].landedAt).toBe(1_000_000);
    clock = 2_000_000;
    log.append({ id: 'm1', ts: 5, type: 'chat-message', payload: { text: 'again' } });
    expect(log.query()[0].landedAt).toBe(1_000_000);
  });
  it('hydrate keeps the persisted landing (it is this device\'s own stamp)', () => {
    const log = new EventLog({ now: () => 9 });
    log.hydrate([{ id: 'm1', ts: 5, type: 'chat-message', landedAt: 7 }]);
    expect(log.query()[0].landedAt).toBe(7);
  });
});

describe('the news counts what LANDED since I looked, not what was said since', () => {
  it('a line said before I looked but delivered after counts as new', async () => {
    const { buildTilePreviews } = await import('../src/v2/circleTilePreviews.js');
    const looked = 1000;
    const late = { id: 'm1', ts: 500, landedAt: 2000, type: 'chat-message', actor: 'addr-b', payload: { circleId: 'c1', text: 'hoi' } };
    const old = { id: 'm0', ts: 400, landedAt: 900, type: 'chat-message', actor: 'addr-b', payload: { circleId: 'c1', text: 'oud' } };
    const out = buildTilePreviews({ events: [late, old], circles: [{ id: 'c1' }], seenAt: { c1: looked }, myRefs: [] });
    expect(out.c1.unread).toBe(1);
  });
  it('an entry from before landedAt existed reads its ts', async () => {
    const { buildTilePreviews } = await import('../src/v2/circleTilePreviews.js');
    const legacy = { id: 'm2', ts: 3000, type: 'chat-message', actor: 'addr-b', payload: { circleId: 'c1', text: 'x' } };
    expect(buildTilePreviews({ events: [legacy], circles: [{ id: 'c1' }], seenAt: { c1: 1000 }, myRefs: [] }).c1.unread).toBe(1);
  });
});

describe('query by arrival: landedSince', () => {
  it('keeps what LANDED since the bound, a late arrival of an old line included; drops what landed before', () => {
    let clock = 1_000;
    const log = new EventLog({ now: () => clock });
    log.append({ id: 'early', ts: 900, type: 'chat-message' });
    clock = 5_000;
    log.append({ id: 'late', ts: 100, type: 'chat-message' });   // said long ago, delivered now
    expect(log.query({ landedSince: 2_000 }).map((e) => e.id)).toEqual(['late']);
    expect(log.query({ since: 2_000 }).map((e) => e.id), 'the sender-time bound would lose it').toEqual([]);
  });
});
