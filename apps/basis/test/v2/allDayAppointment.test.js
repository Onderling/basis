/**
 * An appointment said with a day and no time is ALL-DAY — the household's own convention for a day without a time
 * (a chore due on a day): local midnight. Seen in a household's chat (2026-10-08): "8 november demonstratie" became an
 * appointment at 00:00, its reminders around midnight. Now: the day, start to the next midnight; the reply says the
 * day without a time; the reminders follow the morning (a day has no time to be before).
 */
import { describe, it, expect } from 'vitest';
import { buildEvent } from '@onderling-app/calendar';
import { parseDateAndTime } from '../../src/forms/parseDate.js';
import { replyLine } from '../../src/v2/replyLine.js';
import { reminderOccurrences, householdRules } from '../../src/v2/reminderOccurrences.js';

const t = (k, p) => (k === 'circle.reply.date_locale' ? 'nl-NL' : p ? `${k}:${JSON.stringify(p)}` : k);
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('an appointment with a day and no time', () => {
  it('"tandarts vrijdag": the whole day — local midnight to the next', () => {
    // the gate reads "vrijdag" with the household's date parser, as a person's line reaches addEvent
    const e = buildEvent({ title: 'tandarts', when: parseDateAndTime('vrijdag') });
    const s = new Date(e.startsAt); const end = new Date(e.endsAt);
    expect([s.getHours(), s.getMinutes()]).toEqual([0, 0]);
    expect(s.getDay()).toBe(5);
    expect([end.getHours(), end.getMinutes()]).toEqual([0, 0]);
    expect(Math.round((end - s) / 3_600_000)).toBeGreaterThanOrEqual(23);   // a day (23–25 h across a clock change)
  });

  it('a bare date is the same', () => {
    const e = buildEvent({ title: 'demonstratie', when: '2026-11-08' });
    const s = new Date(e.startsAt);
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours()]).toEqual([2026, 10, 8, 0]);
  });

  it('a day WITH a time stays timed', () => {
    const e = buildEvent({ title: 'kapper', when: '2026-11-08T11:00' });
    expect(new Date(e.startsAt).getHours()).toBe(11);
  });

  it('the reply says the day, without a time', () => {
    const startsAt = new Date(2026, 10, 8).toISOString();
    const line = replyLine({ ok: true, title: 'demonstratie', startsAt }, { opId: 'addEvent', t });
    expect(line).toContain('zo 8 nov');
    expect(line).not.toMatch(/00:00/);
  });

  it('its reminder is the morning — said that morning, not skipped; nothing "minutes before" midnight', () => {
    const startsAt = new Date(2026, 10, 8).toISOString();
    const event = { id: 'e1', title: 'demonstratie', startsAt, createdAt: new Date(2026, 9, 9).toISOString() };
    const at9 = new Date(2026, 10, 8, 9, 0).getTime();
    const due = reminderOccurrences({ events: [event], people: [{ id: 'p' }], now: at9, tz, rulesFor: () => householdRules(5) });
    expect(due.map((o) => [o.rule, o.state])).toEqual([['morning', 'due']]);
    const planned = reminderOccurrences({ events: [event], people: [{ id: 'p' }], now: new Date(2026, 10, 7, 12).getTime(), tz, rulesFor: () => householdRules(5), horizon: 2 * 86_400_000 });
    expect(planned.map((o) => o.rule)).toEqual(['morning']);
  });
});
