/**
 * Read on one device = read on all: one read set, honoured by the circle tiles, Today's news and the contact badges.
 */
import { describe, it, expect } from 'vitest';
import { nextReadMarks, readSetOf, readMarksIdOf, readMarksFloor } from '../../src/v2/readMarks.js';
import { buildTilePreviews } from '../../src/v2/circleTilePreviews.js';
import { buildContactUnread } from '../../src/v2/contactUnread.js';

const NOW = Date.UTC(2026, 10, 9, 12);

describe('nextReadMarks', () => {
  it('adds marks with the source time, one row per self and group', () => {
    const row = nextReadMarks(null, { selfId: 'p-1', group: 'c1', add: [{ id: 'm1', at: NOW - 1000 }], now: NOW });
    expect(row).toMatchObject({ id: readMarksIdOf('p-1', 'c1'), type: 'read-marks', group: 'c1', read: [{ id: 'm1', at: NOW - 1000 }] });
    expect(row.prunedBefore).toBe(readMarksFloor(NOW));
  });
  it('a mark already there changes nothing; a mark below the floor is dropped', () => {
    const row = nextReadMarks(null, { selfId: 'default', group: 'c1', add: [{ id: 'm1', at: NOW }], now: NOW });
    expect(nextReadMarks(row, { selfId: 'default', group: 'c1', add: [{ id: 'm1', at: NOW }], now: NOW })).toBeNull();
    const old = nextReadMarks(row, { selfId: 'default', group: 'c1', add: [{ id: 'ancient', at: 1 }], now: NOW });
    expect(old.read.map((m) => m.id)).toEqual(['m1']);
  });
});

describe('one read set, three readers', () => {
  const read = readSetOf([{ type: 'read-marks', group: 'c1', read: [{ id: 'm1', at: 1 }] }, { type: 'read-marks', group: 'bea', read: [{ id: 'd1', at: 1 }] }]);
  it('a line read on another device is not news here, though this device never looked', () => {
    const lines = [
      { id: 'm1', ts: 10, landedAt: 10, type: 'chat-message', actor: 'b', payload: { circleId: 'c1', text: 'x' } },
      { id: 'm2', ts: 20, landedAt: 20, type: 'chat-message', actor: 'b', payload: { circleId: 'c1', text: 'y' } },
    ];
    const out = buildTilePreviews({ events: lines, circles: [{ id: 'c1' }], seenAt: {}, myRefs: [], readIds: read });
    expect(out.c1.unread).toBe(1);
    expect(out.c1.unreadIds).toEqual([{ id: 'm2', at: 20 }]);
  });
  it('a landed item is marked by its item id', async () => {
    const { landingEntryFor } = await import('../../src/v2/itemLanding.js');
    const e = landingEntryFor({ circleId: 'c1', item: { id: 'p9', type: 'request', source: { from: 'b' } } });
    const out = buildTilePreviews({ events: [e], circles: [{ id: 'c1' }], seenAt: {}, myRefs: [], readIds: new Set(['p9']) });
    expect(out.c1.unread).toBe(0);
  });
  it('a direct message read on another device carries no badge here', () => {
    const turns = [{ contactId: 'bea', origin: 'bot', ts: 5, messageId: 'd1' }, { contactId: 'bea', origin: 'bot', ts: 6, messageId: 'd2' }];
    const out = buildContactUnread({ turns, seenAt: {}, readIds: read });
    expect(out.bea.unread).toBe(1);
    expect(out.bea.unreadIds).toEqual([{ id: 'd2', at: 6 }]);
  });
});

describe('createReadMarks: the shells\' one read set over the waist', () => {
  it('marks only what is not read yet, grows at once, and a refresh reads every self\'s rows', async () => {
    const calls = [];
    const rows = [{ type: 'read-marks', group: 'c1', read: [{ id: 'm0', at: 1 }] }];
    const callSkill = async (app, op, args) => { calls.push([app, op, args]); return op === 'listReadMarks' ? { ok: true, rows } : { ok: true }; };
    const { createReadMarks } = await import('../../src/v2/readMarks.js');
    let repaints = 0;
    const rm = createReadMarks({ callSkill, onChange: () => { repaints += 1; } });
    await rm.refresh();
    expect([...rm.ids()]).toEqual(['m0']);
    await rm.markCircle('c1', [{ id: 'm0', at: 1 }, { id: 'm1', at: 2 }]);
    expect(rm.ids().has('m1')).toBe(true);
    expect(calls.find(([, op]) => op === 'markRead')).toEqual(['household', 'markRead', { group: 'c1', read: [{ id: 'm1', at: 2 }] }]);
    expect(await rm.markCircle('c1', [{ id: 'm1', at: 2 }])).toBe(false);   // nothing new: no write
    expect(repaints).toBe(2);
  });
});

describe('markCircleFrom: opening a circle marks everything unread in it', () => {
  it('marks the lines and landings of others, never my own, with their source times', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => { calls.push(args); return { ok: true, rows: [] }; };
    const { createReadMarks } = await import('../../src/v2/readMarks.js');
    const rm = createReadMarks({ callSkill });
    const events = [
      { id: 'm1', ts: 10, landedAt: 50, type: 'chat-message', actor: 'b', payload: { circleId: 'c1', text: 'x' } },
      { id: 'm2', ts: 20, landedAt: 60, type: 'chat-message', actor: 'me', payload: { circleId: 'c1', text: 'mine' } },
      { id: 'm3', ts: 30, landedAt: 70, type: 'chat-message', actor: 'b', payload: { circleId: 'c2', text: 'other circle' } },
    ];
    await rm.markCircleFrom({ events, circleId: 'c1', myRefs: ['me'] });
    expect(calls.at(-1)).toEqual({ group: 'c1', read: [{ id: 'm1', at: 10 }] });
  });
});

describe('follow: a sibling\'s marks landing re-read the set', () => {
  it('re-reads on a change in an own-devices scope, not on a circle\'s', async () => {
    const { createReadMarks } = await import('../../src/v2/readMarks.js');
    let lists = 0; let fire = null;
    const rm = createReadMarks({ callSkill: async (app, op) => { if (op === 'listReadMarks') lists += 1; return { ok: true, rows: [] }; } });
    rm.follow((fn) => { fire = fn; return () => {}; });
    fire('c1'); await Promise.resolve();
    expect(lists).toBe(0);
    fire('own-devices:p-0123456789ab'); await new Promise((r) => setTimeout(r, 0));
    expect(lists).toBe(1);
  });
});
