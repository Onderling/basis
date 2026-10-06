/**
 * Reminders as derived occurrences: item × the rules that apply × each person it is for → one occurrence each, with an
 * id `<item>:<rule>:<day>:<person>` (two people's reminders of one appointment never share a mark). Nothing is stored.
 * Today's rhythm is the HOUSEHOLD layer's default rules (`morning`, `evening-before`, `before:<lead>`); the
 * household's `evening-before` is only for an appointment early the next morning, a person's own is not; a chore due on
 * a day (no time) takes only `morning`.
 */
import { describe, it, expect } from 'vitest';
import { reminderOccurrences, householdRules } from '../src/v2/reminderOccurrences.js';

const TZ = 'Europe/Amsterdam';
const at = (iso) => Date.parse(iso);
const people = [{ id: 'telegram:1' }, { id: 'telegram:2' }];
const early = { id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-08T07:00:00.000Z', createdBy: 'telegram:1', createdAt: '2026-10-01T10:00:00.000Z' };   // Thu 09:00
const afternoon = { id: 'e2', type: 'calendar-event', title: 'kapper', startsAt: '2026-10-08T12:00:00.000Z', createdBy: 'telegram:1', createdAt: '2026-10-01T10:00:00.000Z' };   // Thu 14:00
const dayChore = { id: 'c1', type: 'task', text: 'vuilnis', dueAt: '2026-10-07T22:00:00.000Z', assignees: ['telegram:2'] };   // Thu (00:00 local)
const timedChore = { id: 'c2', type: 'task', text: 'pakket ophalen', dueAt: '2026-10-08T15:00:00.000Z', assignees: ['telegram:2'], createdAt: '2026-10-01T10:00:00.000Z' };   // Thu 17:00
const run = (now, over = {}) => reminderOccurrences({ chores: [dayChore, timedChore], events: [early, afternoon], people, now: at(now), tz: TZ, ...over });
const ids = (list) => list.map((o) => o.id).sort();

describe('reminder occurrences', () => {
  it('the household default is today\'s rhythm; lead 0 has no short notice', () => {
    expect(householdRules(5)).toEqual(['morning', 'evening-before', 'before:5']);
    expect(householdRules(0)).toEqual(['morning', 'evening-before']);
  });

  it('the evening before (19:00) only for the EARLY appointment, to everyone it is for — each their own occurrence', () => {
    const due = run('2026-10-07T17:30:00Z', { rulesFor: () => householdRules(5) });   // Wed 19:30
    expect(ids(due)).toEqual(['e1:evening-before:2026-10-07:telegram:1', 'e1:evening-before:2026-10-07:telegram:2']);
    expect(due[0]).toMatchObject({ itemId: 'e1', kind: 'event', rule: 'evening-before', state: 'due', slot: '2026-10-07:evening' });
  });

  it('08:00: everything of the day — both appointments to everyone, the day chore to its holder', () => {
    const due = run('2026-10-08T06:00:00Z', { rulesFor: () => householdRules(5) });   // Thu 08:00
    expect(ids(due)).toEqual([
      'c1:morning:2026-10-08:telegram:2', 'c2:morning:2026-10-08:telegram:2',
      'e1:morning:2026-10-08:telegram:1', 'e1:morning:2026-10-08:telegram:2',
      'e2:morning:2026-10-08:telegram:1', 'e2:morning:2026-10-08:telegram:2',
    ]);
  });

  it('shortly before: an appointment and a TIMED chore; never the day chore (no time to be before)', () => {
    expect(ids(run('2026-10-08T11:56:00Z', { rulesFor: () => ['before:5'] }))).toEqual(['e2:before:5:2026-10-08:telegram:1', 'e2:before:5:2026-10-08:telegram:2']);
    expect(ids(run('2026-10-08T14:57:00Z', { rulesFor: () => ['before:5'] }))).toEqual(['c2:before:5:2026-10-08:telegram:2']);
    expect(run('2026-10-08T11:56:00Z', { rulesFor: () => ['before:5'] })[0]).toMatchObject({ soon: true, slot: '2026-10-08:soon' });
  });

  it('a person\'s own evening-before is unconditional: the 14:00 appointment too', () => {
    const own = (item, personId) => (personId === 'telegram:1' ? [{ rule: 'evening-before', layer: 'person' }] : householdRules(5));
    expect(ids(run('2026-10-07T17:30:00Z', { rulesFor: own }))).toEqual([
      'e1:evening-before:2026-10-07:telegram:1', 'e1:evening-before:2026-10-07:telegram:2', 'e2:evening-before:2026-10-07:telegram:1',
    ]);
  });

  it('a day chore takes a person\'s own evening-before (19:00 the day before), never the household\'s', () => {
    const own = (item, personId) => (item.id === 'c1' ? [{ rule: 'evening-before', layer: 'person' }] : []);
    expect(ids(run('2026-10-07T17:30:00Z', { rulesFor: own }))).toEqual(['c1:evening-before:2026-10-07:telegram:2']);
    expect(run('2026-10-07T17:30:00Z', { rulesFor: () => ['evening-before'], events: [] })).toEqual([]);
  });

  it('`at:` a time on the item\'s day, before it; a day chore takes only `morning`', () => {
    const due = run('2026-10-08T05:31:00Z', { rulesFor: () => ['at:07:30'] });   // Thu 07:31
    expect(ids(due)).toEqual([
      'c2:at:07:30:2026-10-08:telegram:2',
      'e1:at:07:30:2026-10-08:telegram:1', 'e1:at:07:30:2026-10-08:telegram:2',
      'e2:at:07:30:2026-10-08:telegram:1', 'e2:at:07:30:2026-10-08:telegram:2',
    ]);
    expect(due.some((o) => o.itemId === 'c1'), 'the day chore has no `at:`').toBe(false);
  });

  it('an appointment made after 08:00 is not that morning\'s news; one made just before its start has no short notice', () => {
    const late = { ...afternoon, id: 'e3', createdAt: '2026-10-08T07:00:00.000Z' };   // made Thu 09:00
    const now = run('2026-10-08T07:30:00Z', { rulesFor: () => ['morning'], events: [late], chores: [] });
    expect(now).toEqual([]);
    const sudden = { ...afternoon, id: 'e4', createdAt: '2026-10-08T11:58:00.000Z' };
    expect(run('2026-10-08T11:58:30Z', { rulesFor: () => ['before:5'], events: [sudden], chores: [] })).toEqual([]);
  });

  it('a cancelled or finished item, a rule outside the vocabulary: nothing', () => {
    const cancelled = { ...early, state: 'cancelled' };
    expect(run('2026-10-07T17:30:00Z', { rulesFor: () => householdRules(5), events: [cancelled], chores: [] })).toEqual([]);
    expect(run('2026-10-08T06:00:00Z', { rulesFor: () => ['every-hour'] })).toEqual([]);
  });

  it('with a horizon, what is still ahead is listed as planned', () => {
    const list = run('2026-10-07T10:00:00Z', { rulesFor: () => householdRules(5), horizon: 30 * 3_600_000 });
    expect(list.every((o) => o.state === 'planned')).toBe(true);
    expect(list.some((o) => o.id === 'e1:evening-before:2026-10-07:telegram:1')).toBe(true);
    expect(list.some((o) => o.id === 'e2:before:5:2026-10-08:telegram:2')).toBe(true);
  });
});
