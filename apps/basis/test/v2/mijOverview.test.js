/**
 * "Mijn overzicht" on the Mij tab — the two cross-circle blocks the Schermen tab used to seed ("Mijn dingen": my
 * chores across every circle; "Mijn agenda": the circles' appointments and my own), declared once in shared code and
 * materialized through the one screen materializer. No screens book behind it: nothing to rename, delete or add.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIJ_OVERVIEW_BLOCKS, MIJ_OVERVIEW_TITLE_KEY, mijOverviewBlocks } from '../../src/v2/mijOverview.js';

const ME = 'webid:me';
const soon = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
const locale = (lang) => JSON.parse(readFileSync(resolve(__dirname, `../../src/locales/circle.${lang}.json`), 'utf8'));
const textAt = (doc, key) => key.replace(/^circle\./, '').split('.').reduce((o, k) => o?.[k], doc)?.text;

function world() {
  const calls = [];
  const callSkill = async (app, op, args = {}) => {
    calls.push([app, op, args.circleId ?? null]);
    if (app === 'stoop' && op === 'listMyCircles') return { ok: true, circles: [{ groupId: 'huis', name: 'Huis' }, 'club'] };
    if (app === 'tasks' && op === 'listOpen') {
      return { items: args.circleId === 'huis' ? [{ id: 't1', text: 'afwas', assignees: [ME], addedAt: 2 }, { id: 't2', text: 'van ann', assignees: ['webid:ann'], addedAt: 3 }] : [] };
    }
    if (app === 'calendar' && op === 'listEvents') {
      if (args.circleId === 'club') return { items: [{ id: 'e2', label: 'training', title: 'training', startsAt: soon(5) }] };
      if (!args.circleId) return { items: [{ id: 'e3', label: 'hardlopen', title: 'hardlopen', startsAt: soon(10) }] };
      return { items: [] };
    }
    return { items: [] };
  };
  return { callSkill, calls };
}

describe('Mijn overzicht — the Mij tab\'s cross-circle blocks', () => {
  it('declares exactly two blocks: my chores (task, mine) and my agenda (calendar-event, all)', () => {
    expect(MIJ_OVERVIEW_BLOCKS.map((b) => [b.type, b.config.noun, b.config.scope])).toEqual([
      ['items', 'task', 'mine'],
      ['items', 'calendar-event', 'all'],
    ]);
    expect(MIJ_OVERVIEW_BLOCKS.map((b) => b.titleKey)).toEqual(['circle.screens.seed_my_things', 'circle.screens.seed_my_calendar']);
  });

  it('materializes both through the one cross-circle projection, each carrying its title', async () => {
    const w = world();
    const [things, agenda] = await mijOverviewBlocks({ callSkill: w.callSkill, me: ME });
    expect(things).toMatchObject({ type: 'items', status: 'ok', titleKey: 'circle.screens.seed_my_things', content: { noun: 'task' } });
    // only the chore I hold, tagged with its circle
    expect(things.content.items.map((i) => [i.label, i.circleName])).toEqual([['afwas', 'Huis']]);
    expect(agenda).toMatchObject({ type: 'items', status: 'ok', titleKey: 'circle.screens.seed_my_calendar', content: { noun: 'calendar-event' } });
    // the circles' appointments and my own, soonest first
    expect(agenda.content.items.map((i) => [i.label, i.circleId])).toEqual([['training', 'club'], ['hardlopen', null]]);
    // the circles come from the same list Gepland reads
    expect(w.calls).toContainEqual(['stoop', 'listMyCircles', null]);
  });

  it('with no circles both blocks are present and empty (never a missing section)', async () => {
    const callSkill = async (app, op) => (app === 'stoop' && op === 'listMyCircles' ? { circles: [] } : { items: [] });
    const blocks = await mijOverviewBlocks({ callSkill, me: ME });
    expect(blocks.map((b) => [b.titleKey, b.status])).toEqual([
      ['circle.screens.seed_my_things', 'empty'],
      ['circle.screens.seed_my_calendar', 'empty'],
    ]);
  });

  it('a materializer that throws still yields both blocks, each saying it could not load', async () => {
    // a circles answer that throws when it is read
    const callSkill = async (app, op) => (app === 'stoop' && op === 'listMyCircles' ? { get circles() { throw new Error('boom'); } } : { items: [] });
    const blocks = await mijOverviewBlocks({ callSkill, me: ME });
    expect(blocks.map((b) => b.titleKey)).toEqual(['circle.screens.seed_my_things', 'circle.screens.seed_my_calendar']);
    expect(blocks.map((b) => b.status)).toEqual(['error', 'error']);
  });

  it('every title it names is worded in nl and en', () => {
    const nl = locale('nl'); const en = locale('en');
    expect(textAt(nl, MIJ_OVERVIEW_TITLE_KEY)).toBe('Mijn overzicht');
    expect(textAt(en, MIJ_OVERVIEW_TITLE_KEY)).toBe('My overview');
    for (const b of MIJ_OVERVIEW_BLOCKS) {
      expect(textAt(nl, b.titleKey), b.titleKey).toBeTruthy();
      expect(textAt(en, b.titleKey), b.titleKey).toBeTruthy();
    }
    expect(textAt(nl, 'circle.screens.seed_my_things')).toBe('Mijn dingen');
    expect(textAt(nl, 'circle.screens.seed_my_calendar')).toBe('Mijn agenda');
  });
});
