/**
 * A chore can have a time (Frits 2026-10-05: "yes also chores can get times"): "ramen do 18:00" is due at 18:00, and it
 * is reminded shortly before that time — the household's lead, as an appointment is — to whoever holds it, besides the
 * morning. A chore due on a DAY (no time: the day's 00:00) keeps only the morning one.
 */
import { describe, it, expect } from 'vitest';
import { dueReminders } from '../src/v2/botReminders.js';

const tz = 'Europe/Amsterdam';
const at = (iso) => Date.parse(iso);

describe('a chore with a time', () => {
  const chore = { id: 'c1', text: 'ramen', dueAt: '2026-10-07T16:00:00Z', assignees: ['ann'], createdAt: '2026-10-06T10:00:00Z' };   // 18:00 in Amsterdam
  const people = [{ id: 'ann', role: 'member' }];

  it('reminded the lead before its time, once', () => {
    const due = dueReminders({ chores: [chore], people, now: at('2026-10-07T15:56:00Z'), tz, lead: 5 });
    const soon = (due.find((d) => d.personId === 'ann')?.items ?? []).filter((i) => i.soon);
    expect(soon).toEqual([expect.objectContaining({ id: 'c1', kind: 'chore', soon: true })]);
    const said = { ann: { c1: soon[0].slot } };
    expect(dueReminders({ chores: [chore], people, said, now: at('2026-10-07T15:57:00Z'), tz, lead: 5 })
      .flatMap((d) => d.items).filter((i) => i.soon)).toEqual([]);
  });

  it('a chore on a day (no time) has no short-notice reminder', () => {
    const dayOnly = { ...chore, dueAt: '2026-10-06T22:00:00Z' };   // 00:00 on the 7th in Amsterdam
    const due = dueReminders({ chores: [dayOnly], people, now: at('2026-10-06T21:56:00Z'), tz, lead: 5 });
    expect(due.flatMap((d) => d.items).filter((i) => i.soon)).toEqual([]);
  });
});

describe('its words', () => {
  it('the short-notice reminder of a chore says the time', async () => {
    const nl = (await import('../src/locales/circle.nl.json', { with: { type: 'json' } })).default;
    expect(nl.bot.reminder_chore_soon).toContain('{{time}}');
  });
});
