/**
 * What a household bot must say now, as a PROJECTION: a pure read over the items (an appointment's `startsAt`, a
 * chore's `dueAt`), the people and what was already said — no stored jobs, so a moved or cancelled appointment needs no
 * bookkeeping and a restart loses nothing. Only things a person dated; an appointment the evening before (19:00), a
 * chore the morning it is due (08:00); nothing in quiet hours; everything for one person at one moment is one entry.
 */
import { describe, it, expect } from 'vitest';
import { dueReminders } from '../src/v2/botReminders.js';

const TZ = 'Europe/Amsterdam';
// 2026-10-01 is a Thursday; Amsterdam is UTC+2 in October
const at = (iso) => new Date(iso).getTime();
const people = [{ id: 'frits' }, { id: 'bert' }, { id: 'anne' }, { id: 'olga', role: 'observer' }, { id: 'gone', revoked: true }];
const tandarts = { id: 'e1', title: 'tandarts', startsAt: '2026-10-02T08:00:00.000Z', createdBy: 'frits', rsvp: { bert: 'accepted', anne: 'declined' } };

describe('what the bot must say now', () => {
  it('an appointment tomorrow: at 19:00 the evening before, to its maker and to those who come — not to others', () => {
    const due = dueReminders({ events: [tandarts], people, now: at('2026-10-01T17:05:00.000Z'), tz: TZ });   // 19:05
    expect(due.map((d) => d.personId).sort()).toEqual(['bert', 'frits']);
    expect(due[0].items[0]).toMatchObject({ id: 'e1', kind: 'event', text: 'tandarts' });
    expect(due[0].slot).toBe('2026-10-01:evening');
    // before 19:00: not yet
    expect(dueReminders({ events: [tandarts], people, now: at('2026-10-01T16:30:00.000Z'), tz: TZ })).toEqual([]);
  });

  it('said once, it is not due again; moved to next week or cancelled, it is not due', () => {
    const now = at('2026-10-01T17:05:00.000Z');
    const said = { frits: { e1: '2026-10-01:evening' } };
    expect(dueReminders({ events: [tandarts], people, said, now, tz: TZ }).map((d) => d.personId)).toEqual(['bert']);
    expect(dueReminders({ events: [{ ...tandarts, startsAt: '2026-10-09T08:00:00.000Z' }], people, now, tz: TZ })).toEqual([]);
    expect(dueReminders({ events: [{ ...tandarts, state: 'cancelled' }], people, now, tz: TZ })).toEqual([]);
  });

  it('a chore due today: at 08:00, to the one who holds it; not once it is done', () => {
    const chore = { id: 'c1', text: 'kleurenwiezen', dueAt: '2026-10-01T22:00:00.000Z', assignees: ['frits'] };   // Fri 2 Oct, local midnight
    const today = { ...chore, dueAt: '2026-09-30T22:00:00.000Z' };                                                 // Thu 1 Oct, local midnight
    const due = dueReminders({ chores: [today], people, now: at('2026-10-01T06:10:00.000Z'), tz: TZ });   // 08:10
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ personId: 'frits', slot: '2026-10-01:morning' });
    expect(dueReminders({ chores: [{ ...today, completedAt: 1 }], people, now: at('2026-10-01T06:10:00.000Z'), tz: TZ })).toEqual([]);
    expect(dueReminders({ chores: [chore], people, now: at('2026-10-01T06:10:00.000Z'), tz: TZ })).toEqual([]);   // due tomorrow
  });

  it('in quiet hours nothing is due; when they end, the morning opens', () => {
    const today = { id: 'c1', text: 'kleurenwiezen', dueAt: '2026-09-30T22:00:00.000Z', assignees: ['frits'] };
    expect(dueReminders({ chores: [today], people, now: at('2026-09-30T21:00:00.000Z'), tz: TZ })).toEqual([]);   // 23:00
    expect(dueReminders({ chores: [today], people, now: at('2026-10-01T05:30:00.000Z'), tz: TZ })).toEqual([]);   // 07:30
    expect(dueReminders({ chores: [today], people, now: at('2026-10-01T06:00:00.000Z'), tz: TZ })).toHaveLength(1); // 08:00
  });

  it('two things for one person at one moment are one entry; an observer and a revoked person get none', () => {
    const now = at('2026-10-01T17:10:00.000Z');   // 19:10: a chore due today still open, an appointment tomorrow
    const chore = { id: 'c1', text: 'vuilnis', dueAt: '2026-09-30T22:00:00.000Z', assignees: ['frits', 'olga', 'gone'] };
    const due = dueReminders({ chores: [chore], events: [tandarts], people, now, tz: TZ });
    const frits = due.find((d) => d.personId === 'frits');
    expect(frits.items.map((i) => i.id).sort()).toEqual(['c1', 'e1']);
    expect(due.find((d) => d.personId === 'olga')).toBeUndefined();
    expect(due.find((d) => d.personId === 'gone')).toBeUndefined();
  });

  it('a person who switched reminders off gets none', () => {
    const now = at('2026-10-01T17:05:00.000Z');
    const off = people.map((p) => (p.id === 'frits' ? { ...p, remindersOff: true } : p));
    expect(dueReminders({ events: [tandarts], people: off, now, tz: TZ }).map((d) => d.personId)).toEqual(['bert']);
  });
});
