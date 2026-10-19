/**
 * THE DAY'S SHAPE on Vandaag: appointments grouped now · soon · later today · tomorrow · after (the first group
 * that has any open, the rest folded); chores open first, the done ones folded under "gedaan (n)".
 */
import { describe, it, expect } from 'vitest';
import { agendaGroups, taskGroups, momentWords } from '../../src/v2/dayShape.js';

const at = (h, m = 0, dayOffset = 0) => { const d = new Date('2026-10-19T00:00:00'); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.getTime(); };
const now = at(10, 0);

describe('agendaGroups', () => {
  it('groups by the moment, in order, only non-empty groups; the first is open', () => {
    const items = [
      { id: 'a', when: at(9, 30) },          // started half an hour ago → now
      { id: 'b', when: at(11, 0) },          // within two hours → soon
      { id: 'c', when: at(17, 0) },          // later today
      { id: 'd', when: at(9, 0, 1) },        // tomorrow
      { id: 'e', when: at(9, 0, 5) },        // after
    ];
    const g = agendaGroups(items, { now });
    expect(g.map((x) => [x.key, x.items.map((i) => i.id), x.open])).toEqual([
      ['now', ['a'], true], ['soon', ['b'], false], ['later', ['c'], false], ['tomorrow', ['d'], false], ['after', ['e'], false],
    ]);
    expect(g[0].labelKey).toBe('circle.vandaag.group_now');
  });
  it('the first NON-EMPTY group is open', () => {
    const g = agendaGroups([{ id: 'd', when: at(9, 0, 1) }], { now });
    expect(g.map((x) => [x.key, x.open])).toEqual([['tomorrow', true]]);
  });
});

describe('a past appointment', () => {
  it('is folded under its own last group ("voorbij"), never open — never read as a future one', () => {
    const g = agendaGroups([{ id: 'old', when: at(6, 0) }, { id: 'later', when: at(9, 0, 5) }], { now });
    expect(g.map((x) => [x.key, x.items.map((i) => i.id), x.open])).toEqual([['after', ['later'], true], ['past', ['old'], false]]);
    expect(agendaGroups([{ id: 'old', when: at(6, 0) }], { now }).map((x) => [x.key, x.open])).toEqual([['past', false]]);
  });
});

describe('taskGroups', () => {
  it('open first; the done ones folded with their count', () => {
    const r = taskGroups([{ id: 'x', done: true }, { id: 'y' }, { id: 'z', done: false }]);
    expect(r.open.map((i) => i.id)).toEqual(['y', 'z']);
    expect(r.done.map((i) => i.id)).toEqual(['x']);
  });
});

describe('momentWords', () => {
  const t = (k, v) => (k === 'circle.vandaag.at_time' ? `om ${v.time}` : k);
  it('"om 14:00" today; the time under tomorrow; the day after that', () => {
    expect(momentWords(at(14, 0), 'later', { t })).toBe('om 14:00');
    expect(momentWords(at(9, 0, 1), 'tomorrow', { t })).toBe('09:00');
    expect(momentWords(at(9, 0, 5), 'after', { t, locale: 'nl' })).toMatch(/09:00/);
    expect(momentWords(0, 'after', { t })).toBe('');
  });
});

