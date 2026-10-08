/**
 * "Mijn overzicht" on the Mij tab — Gepland's rows on top (the coming days, appointments and dated chores), and below
 * them the one cross-circle block the Schermen tab used to seed: "Mijn dingen", my chores across every circle (undated
 * ones too). Declared once in shared code and materialized through the one screen materializer. "Mijn agenda" is not
 * here: Gepland already shows the appointments, with the own store and a window. No screens book behind it.
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
  it('declares exactly one block: my chores (task, mine) — the appointments are Gepland\'s', () => {
    expect(MIJ_OVERVIEW_BLOCKS.map((b) => [b.type, b.config.noun, b.config.scope])).toEqual([['items', 'task', 'mine']]);
    expect(MIJ_OVERVIEW_BLOCKS.map((b) => b.titleKey)).toEqual(['circle.screens.seed_my_things']);
  });

  it('materializes it through the one cross-circle projection, carrying its title', async () => {
    const w = world();
    const blocks = await mijOverviewBlocks({ callSkill: w.callSkill, me: ME });
    expect(blocks).toHaveLength(1);
    const [things] = blocks;
    expect(things).toMatchObject({ type: 'items', status: 'ok', titleKey: 'circle.screens.seed_my_things', content: { noun: 'task' } });
    // only the chore I hold, tagged with its circle
    expect(things.content.items.map((i) => [i.label, i.circleName])).toEqual([['afwas', 'Huis']]);
    // no appointment is read for it (Gepland reads those)
    expect(w.calls.some(([app]) => app === 'calendar')).toBe(false);
    // the circles come from the same list Gepland reads
    expect(w.calls).toContainEqual(['stoop', 'listMyCircles', null]);
  });

  it('with no circles the block is present and empty (never a missing section)', async () => {
    const callSkill = async (app, op) => (app === 'stoop' && op === 'listMyCircles' ? { circles: [] } : { items: [] });
    const blocks = await mijOverviewBlocks({ callSkill, me: ME });
    expect(blocks.map((b) => [b.titleKey, b.status])).toEqual([['circle.screens.seed_my_things', 'empty']]);
  });

  it('a materializer that throws still yields the block, saying it could not load', async () => {
    // a circles answer that throws when it is read
    const callSkill = async (app, op) => (app === 'stoop' && op === 'listMyCircles' ? { get circles() { throw new Error('boom'); } } : { items: [] });
    const blocks = await mijOverviewBlocks({ callSkill, me: ME });
    expect(blocks.map((b) => [b.titleKey, b.status])).toEqual([['circle.screens.seed_my_things', 'error']]);
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
  });
});
