/**
 * Gepland in the app — a LOCAL projection on the person's own device (Frits 2026-10-07: the household bot is optional,
 * so this is not the bot's answer): what is coming for me in the next days, wherever it lives — the appointments of
 * every circle I am in and my own (the own store), the chores I hold that carry a date — in time order, each saying
 * where it comes from. No door, no bot.
 */
import { describe, it, expect } from 'vitest';
import { plannedForMe } from '../src/v2/plannedForMe.js';

const ME = 'webid:me';
const NOW = Date.parse('2026-10-07T08:00:00Z');
const at = (h) => new Date(NOW + h * 3_600_000).toISOString();

function world({ circles = [{ groupId: 'huis', name: 'Huis' }, 'werk'] } = {}) {
  const calls = [];
  const callSkill = async (app, op, args = {}) => {
    calls.push([app, op, args.circleId ?? null]);
    if (app === 'stoop' && op === 'listMyCircles') return { ok: true, circles };
    if (app === 'calendar' && op === 'listEvents') {
      if (args.circleId === 'huis') return { ok: true, items: [{ id: 'e1', title: 'tandarts', startsAt: at(26) }, { id: 'e9', title: 'later', startsAt: at(24 * 30) }] };
      if (!args.circleId) return { ok: true, items: [{ id: 'o1', title: 'hardlopen', startsAt: at(2) }] };
      return { ok: true, items: [] };
    }
    if (app === 'tasks') {
      if (args.circleId === 'huis') return { ok: true, items: [
        { id: 't1', type: 'task', text: 'vuilnis', dueAt: at(14), assignees: [ME] },
        { id: 't2', type: 'task', text: 'ramen', dueAt: at(20), assignees: ['webid:bob'] },
        { id: 't3', type: 'task', text: 'zonder datum', assignees: [ME] },
      ] };
      return { ok: true, items: [] };
    }
    return { ok: true, items: [] };
  };
  return { callSkill, calls };
}

describe('Gepland — what is coming for me, wherever it lives', () => {
  it('my own and my circles\' appointments and my dated chores, in time order, each saying where from', async () => {
    const w = world();
    const r = await plannedForMe({ callSkill: w.callSkill, me: ME, now: NOW, horizonDays: 7 });
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => [i.kind, i.title, i.circleName])).toEqual([
      ['event', 'hardlopen', ''],      // my own, no circle
      ['chore', 'vuilnis', 'Huis'],    // mine, dated
      ['event', 'tandarts', 'Huis'],
    ]);
  });

  it('not another person\'s chore, not an undated one, nothing past the horizon', async () => {
    const r = await plannedForMe({ callSkill: world().callSkill, me: ME, now: NOW, horizonDays: 7 });
    const titles = r.items.map((i) => i.title);
    expect(titles).not.toContain('ramen');
    expect(titles).not.toContain('zonder datum');
    expect(titles).not.toContain('later');
  });

  it('without circles it still shows my own; nothing at all is an empty list, not an error', async () => {
    const r = await plannedForMe({ callSkill: world({ circles: [] }).callSkill, me: ME, now: NOW });
    expect(r.items.map((i) => i.title)).toEqual(['hardlopen']);
  });
});

describe('Gepland lines, in the person\'s words', async () => {
  const { plannedLines } = await import('../src/v2/plannedForMe.js');
  const tt = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  it('an appointment with its time and where; a chore due on a day without a time; my own without a circle', () => {
    const lines = plannedLines([
      { kind: 'event', title: 'tandarts', when: Date.parse('2026-10-08T12:00:00Z'), circleName: 'Huis' },
      { kind: 'chore', title: 'vuilnis', when: Date.parse('2026-10-08T22:00:00Z'), circleName: 'Huis' },
      { kind: 'event', title: 'hardlopen', when: Date.parse('2026-10-08T06:00:00Z'), circleName: '' },
    ], { t: tt, tz: 'Europe/Amsterdam', lang: 'nl' });
    expect(lines[0]).toContain('circle.profile.planned_event');
    expect(lines[0]).toContain('14:00');
    expect(lines[0]).toContain('Huis');
    expect(lines[1]).toContain('circle.profile.planned_chore');
    expect(lines[1]).not.toContain('00:00');
    expect(lines[2]).not.toContain('planned_where');
  });
});
