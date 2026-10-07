/**
 * Pending work, read: `upcoming` lists every occurrence of the open intention rows in time order — planned, due or
 * skipped — and `due` is that list cut at now. Nothing is stored but the rows and the done-marks: an occurrence's id
 * is its row (`at`) or its row and slot (`every`), and a done-mark under that id is what takes it off.
 */
import { describe, it, expect } from 'vitest';
import { upcoming, due, occurrenceId, eventOccurrences } from '../src/v2/intentions.js';
import { validate } from '@onderling/item-types';

const TZ = 'Europe/Amsterdam';
const H = 3_600_000;
const D = 24 * H;
const at = (iso) => new Date(iso).getTime();
const row = (over) => ({
  type: 'intention', id: 'r1', createdAt: '2026-10-01T10:00:00.000Z', createdBy: 'telegram:1',
  op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs: 'telegram:1', label: 'weekoverzicht', state: 'open',
  ...over,
});
// made on Monday 5 October: the Sunday before it is not owed
const weekly = row({ createdAt: '2026-10-05T10:00:00.000Z', trigger: { every: 'week', on: 'sun', at: '18:00' } });

describe('the intention type', () => {
  it('is in the dictionary: a row with a trigger and a waist call validates, one without an op does not', () => {
    expect(validate(weekly).ok).toBe(true);
    expect(validate(row({ trigger: { at: '2026-10-08T13:00:00.000Z' } })).ok).toBe(true);
    const { op, ...noOp } = weekly;
    expect(validate(noOp).ok).toBe(false);
  });
});

describe('upcoming and due', () => {
  it('an `at` row: planned before its moment, due from it, skipped once its day is over, gone when done', () => {
    const r = row({ trigger: { at: '2026-10-08T13:00:00.000Z' } });   // Thu 15:00 in Amsterdam
    const one = (now, done = []) => upcoming({ rows: [r], done: new Set(done), now, tz: TZ, horizon: 7 * D });
    expect(one(at('2026-10-08T12:00:00Z')).map((o) => o.state)).toEqual(['planned']);
    expect(one(at('2026-10-08T14:00:00Z')).map((o) => o.state)).toEqual(['due']);
    expect(one(at('2026-10-08T23:00:00Z')).map((o) => o.state)).toEqual(['skipped']);   // Fri 01:00 local
    expect(occurrenceId(r, one(at('2026-10-08T14:00:00Z'))[0].slot)).toBe('r1');
    expect(one(at('2026-10-08T14:00:00Z'), ['r1'])).toEqual([]);
  });

  it('a weekly row lists its next Sundays at 18:00 local, and is due on the Sunday from 18:00', () => {
    const sat = at('2026-10-10T10:00:00Z');
    const list = upcoming({ rows: [weekly], done: new Set(), now: sat, tz: TZ, horizon: 14 * D });
    expect(list.map((o) => [o.slot, o.state])).toEqual([['2026-10-11', 'planned'], ['2026-10-18', 'planned']]);
    expect(new Date(list[0].at).toISOString()).toBe('2026-10-11T16:00:00.000Z');   // 18:00 CEST
    const sunEvening = at('2026-10-11T17:30:00Z');
    const now = due({ rows: [weekly], done: new Set(), now: sunEvening, tz: TZ });
    expect(now.map((o) => o.id)).toEqual(['r1:2026-10-11']);
    expect(due({ rows: [weekly], done: new Set(['r1:2026-10-11']), now: sunEvening, tz: TZ })).toEqual([]);
  });

  it('18:00 stays 18:00 across the change to winter time', () => {
    const list = upcoming({ rows: [weekly], done: new Set(), now: at('2026-10-20T10:00:00Z'), tz: TZ, horizon: 14 * D }).filter((o) => o.state === 'planned');
    expect(list.map((o) => new Date(o.at).toISOString())).toEqual(['2026-10-25T17:00:00.000Z', '2026-11-01T17:00:00.000Z']);
  });

  it('a row with a clock time may run the rest of THAT day; an interval row the whole interval; a row may set its own', () => {
    const monday = at('2026-10-12T09:00:00Z');
    // the Sunday overview missed on Sunday is not sent on Monday
    expect(due({ rows: [weekly], done: new Set(), now: monday, tz: TZ })).toEqual([]);
    const skipped = upcoming({ rows: [weekly], done: new Set(), now: monday, tz: TZ, horizon: 2 * D });
    expect(skipped.map((o) => [o.slot, o.state])).toEqual([['2026-10-11', 'skipped']]);
    // still due late that Sunday evening
    expect(due({ rows: [weekly], done: new Set(), now: at('2026-10-11T21:30:00Z'), tz: TZ }).map((o) => o.id)).toEqual(['r1:2026-10-11']);
    // its own window: two days
    const longer = row({ ...weekly, window: 2 * D });
    expect(due({ rows: [longer], done: new Set(), now: monday, tz: TZ }).map((o) => o.id)).toEqual(['r1:2026-10-11']);
  });

  it('an interval row that missed several runs fires ONCE, for the latest', () => {
    const r = row({ id: 'rot', createdAt: '2026-06-01T00:00:00.000Z', trigger: { everyMs: 30 * D, from: '2026-06-01T00:00:00.000Z' } });
    const now = at('2026-10-07T12:00:00Z');   // four periods missed; the latest started 29 September
    const d = due({ rows: [r], done: new Set(), now, tz: TZ });
    expect(d).toHaveLength(1);
    expect(new Date(d[0].at).toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });

  it('a row made midweek does not owe the Sunday before it: nothing before the row exists', () => {
    const r = row({ ...weekly, createdAt: '2026-10-14T09:00:00.000Z' });   // Wednesday
    expect(due({ rows: [r], done: new Set(), now: at('2026-10-14T10:00:00Z'), tz: TZ })).toEqual([]);
    expect(due({ rows: [r], done: new Set(), now: at('2026-10-18T16:30:00Z'), tz: TZ }).map((o) => o.id)).toEqual(['r1:2026-10-18']);
  });

  it('a run recorded on the row (`lastRunAt`) counts as done for that occurrence and every earlier one', () => {
    const r = row({ ...weekly, lastRunAt: '2026-10-11T16:05:00.000Z' });
    expect(due({ rows: [r], done: new Set(), now: at('2026-10-11T17:30:00Z'), tz: TZ })).toEqual([]);
  });

  it('a cancelled or finished row has no occurrences; an unknown trigger has none either (the grammar is closed)', () => {
    const now = at('2026-10-11T17:30:00Z');
    for (const state of ['cancelled', 'done']) expect(upcoming({ rows: [row({ ...weekly, state })], done: new Set(), now, tz: TZ, horizon: 7 * D })).toEqual([]);
    expect(upcoming({ rows: [row({ trigger: { cron: '0 18 * * 0' } })], done: new Set(), now, tz: TZ, horizon: 7 * D })).toEqual([]);
  });

  it('occurrences of several rows come in time order, and carry the waist call and as whom', () => {
    const a = row({ id: 'a', trigger: { at: '2026-10-11T08:00:00.000Z' }, op: 'x' });
    const list = upcoming({ rows: [weekly, a], done: new Set(), now: at('2026-10-10T10:00:00Z'), tz: TZ, horizon: 7 * D });
    expect(list.map((o) => o.rowId)).toEqual(['a', 'r1']);
    expect(list[1]).toMatchObject({ op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs: 'telegram:1', label: 'weekoverzicht' });
  });
});

describe('event triggers', () => {
  const row = (event, extra = {}) => ({ id: 'r1', type: 'intention', state: 'open', trigger: { event: { circleId: 'c1', ...event } }, op: 'announceChange', appOrigin: 'assistant', args: { kinds: ['new'] }, actsAs: 'household', ...extra });
  const appt = (v) => ({ id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-12T12:00:00.000Z', clock: v, ...(v > 1 ? { startsAt: '2026-10-12T13:00:00.000Z' } : {}) });

  it('an "added" row fires for a new item of its type, in its circle', () => {
    const list = eventOccurrences({ rows: [row({ kind: 'added', type: 'calendar-event' })], change: { circleId: 'c1', before: null, after: appt(1) } });
    expect(list).toEqual([expect.objectContaining({ id: 'r1:e1:1', rowId: 'r1', op: 'announceChange', actsAs: 'household', args: { kinds: ['new'], change: { circleId: 'c1', itemId: 'e1', before: null, after: appt(1) } } })]);
  });

  it('a "changed" row fires only when its field changed; other types, other circles and closed rows do not fire', () => {
    const moved = { circleId: 'c1', before: appt(1), after: appt(2) };
    expect(eventOccurrences({ rows: [row({ kind: 'changed', type: 'calendar-event', field: 'startsAt' })], change: moved })).toHaveLength(1);
    expect(eventOccurrences({ rows: [row({ kind: 'changed', type: 'calendar-event', field: 'state' })], change: moved })).toEqual([]);
    expect(eventOccurrences({ rows: [row({ kind: 'changed', type: 'task' })], change: moved })).toEqual([]);
    expect(eventOccurrences({ rows: [row({ kind: 'changed', circleId: 'c2' })], change: moved })).toEqual([]);
    expect(eventOccurrences({ rows: [row({ kind: 'changed' }, { state: 'cancelled' })], change: moved })).toEqual([]);
    expect(eventOccurrences({ rows: [row({ kind: 'added' })], change: moved })).toEqual([]);
  });

  it('a change already acted on (its done-mark) does not fire again; time rows never fire on a change', () => {
    const change = { circleId: 'c1', before: null, after: appt(1) };
    expect(eventOccurrences({ rows: [row({ kind: 'added' })], change, done: new Set(['r1:e1:1']) })).toEqual([]);
    expect(eventOccurrences({ rows: [{ ...row({}), trigger: { every: 'day', at: '08:00' } }], change })).toEqual([]);
  });

  it('a row that names no circle is a person\'s own: it fires for the own-devices scope, never for a circle', async () => {
    const { OWN_DEVICES_SCOPE } = await import('../src/v2/grantsManifest.js');
    const personal = { id: 'r2', type: 'intention', state: 'open', trigger: { event: { kind: 'added', type: 'calendar-event' } }, op: 'x', actsAs: 'telegram:1' };
    expect(eventOccurrences({ rows: [personal], change: { circleId: 'c1', before: null, after: appt(1) } })).toEqual([]);
    expect(eventOccurrences({ rows: [personal], change: { circleId: OWN_DEVICES_SCOPE, before: null, after: appt(1) } })).toHaveLength(1);
  });

  it('a row with an event trigger has no moments in time', () => {
    expect(upcoming({ rows: [row({ kind: 'added' })], now: Date.parse('2026-10-11T10:00:00Z'), tz: 'Europe/Amsterdam' })).toEqual([]);
  });
});
