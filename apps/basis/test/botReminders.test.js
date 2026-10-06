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
const tandarts = { id: 'e1', title: 'tandarts', startsAt: '2026-10-02T07:00:00.000Z', createdBy: 'frits', rsvp: { bert: 'accepted', anne: 'declined' } };

describe('what the bot must say now', () => {
  it('an appointment tomorrow: at 19:00 the evening before, to everyone in the household — but not who said no', () => {
    // Frits 2026-10-06 (a member's feedback: "gezamenlijke afspraken … dat iedereen er een melding van krijgt"): the
    // household's agenda is shared — everyone is reminded, unless the appointment names people
    const due = dueReminders({ events: [tandarts], people, now: at('2026-10-01T17:05:00.000Z'), tz: TZ });   // 19:05
    expect(due.map((d) => d.personId).sort()).toEqual(['bert', 'frits']);   // anne declined; olga observes; gone is gone
    expect(due[0].items[0]).toMatchObject({ id: 'e1', kind: 'event', text: 'tandarts' });
    expect(due[0].slot).toBe('2026-10-01:evening');
    // before 19:00: not yet
    expect(dueReminders({ events: [tandarts], people, now: at('2026-10-01T16:30:00.000Z'), tz: TZ })).toEqual([]);
  });

  it('nobody answered: everyone is reminded (the shared agenda), not only its maker', () => {
    const eten = { id: 'e2', title: 'eten', startsAt: '2026-10-02T06:45:00.000Z', createdBy: 'anne' };   // Fri 08:45: early, reminded the evening before
    const due = dueReminders({ events: [eten], people, now: at('2026-10-01T17:05:00.000Z'), tz: TZ });
    expect(due.map((d) => d.personId).sort()).toEqual(['anne', 'bert', 'frits']);
  });

  it('an appointment that NAMES people reminds them (and its maker, and who said they come) — nobody else', () => {
    const henk = { id: 'e3', title: 'tandarts', startsAt: '2026-10-02T07:00:00.000Z', createdBy: 'frits', attendees: ['bert'] };
    const due = dueReminders({ events: [henk], people, now: at('2026-10-01T17:05:00.000Z'), tz: TZ });
    expect(due.map((d) => d.personId).sort()).toEqual(['bert', 'frits']);
    const shortly = dueReminders({ events: [{ ...henk, createdAt: '2026-09-30T08:00:00.000Z' }], people, now: at('2026-10-02T06:56:00.000Z'), tz: TZ, lead: 5 });
    expect(shortly.map((d) => d.personId).sort()).toEqual(['bert', 'frits']);
    const all = dueReminders({ events: [{ id: 'e4', title: 'eten', startsAt: '2026-10-02T08:00:00.000Z', createdAt: '2026-09-30T08:00:00.000Z', createdBy: 'frits' }], people, now: at('2026-10-02T07:56:00.000Z'), tz: TZ, lead: 5 });
    expect(all.map((d) => d.personId).sort(), 'the short notice too: everyone').toEqual(['anne', 'bert', 'frits']);
  });

  it('the rhythm (Frits 2026-10-06): the evening before only for an EARLY appointment; 08:00 says everything of today', () => {
    const early = { id: 'e5', title: 'fysio', startsAt: '2026-10-02T06:30:00.000Z', createdBy: 'frits' };   // Fri 08:30
    const afternoon = { id: 'e6', title: 'tandarts', startsAt: '2026-10-02T12:00:00.000Z', createdBy: 'frits' };   // Fri 14:00
    const evening = dueReminders({ events: [early, afternoon], people, now: at('2026-10-01T17:05:00.000Z'), tz: TZ });   // Thu 19:05
    expect(evening.flatMap((d) => d.items.map((i) => i.id))).toContain('e5');
    expect(evening.flatMap((d) => d.items.map((i) => i.id)), 'a 14:00 appointment is not reminded the evening before').not.toContain('e6');
    // the morning of the day: today's appointments that have not begun, beside the chores due today
    const morning = dueReminders({ events: [early, afternoon], people, now: at('2026-10-02T06:05:00.000Z'), tz: TZ });   // Fri 08:05
    const ids = morning.find((d) => d.personId === 'bert')?.items.map((i) => i.id) ?? [];
    expect(ids, 'the 14:00 tandarts is in the 08:00 message, for everyone').toContain('e6');
    expect(ids, 'the 08:30 fysio had its evening; at 08:05 it is still to come, so it is said too').toContain('e5');
    expect(morning.find((d) => d.personId === 'bert').items.find((i) => i.id === 'e6').slot).toBe('2026-10-02:morning');
    // one made after 08:00 today is not this morning's news (it is reminded shortly before): no message at 11:25 for it
    const later = { ...afternoon, id: 'e7', createdAt: '2026-10-02T09:24:00.000Z' };   // made Fri 11:24
    expect(dueReminders({ events: [later], people, now: at('2026-10-02T09:25:00.000Z'), tz: TZ })).toEqual([]);
    // past appointments are never in the morning
    expect(dueReminders({ events: [{ ...afternoon, startsAt: '2026-10-02T05:00:00.000Z' }], people, now: at('2026-10-02T06:05:00.000Z'), tz: TZ })).toEqual([]);
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
