/**
 * ONE `items` block on a user screen, for any item type, over the one cross-circle projection: "Mijn dingen" is
 * task/mine, "Mijn agenda" is calendar-event — the circles' appointments merged with the person's own calendar,
 * soonest first. A screen that still holds the old `tasks` or `calendar` block is read as the `items` block it is.
 */
import { describe, it, expect } from 'vitest';
import { materializeScreen } from '../src/v2/userScreenBlocks.js';

const circles = [{ id: 'home', name: 'Thuis' }, { id: 'club', name: 'Club' }];
const soon = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

function hostOps() {
  return {
    circles, myWebid: 'me',
    callSkill: async (app, op, args) => {
      if (app === 'tasks' && op === 'listOpen') return { items: args.circleId === 'home' ? [{ id: 't1', text: 'afwas', assignee: 'me', addedAt: 2 }, { id: 't2', text: 'van ann', assignee: 'ann', addedAt: 3 }] : [] };
      if (app === 'calendar' && op === 'listEvents' && args.circleId === 'home') return { items: [{ id: 'e1', label: 'do 10:00 · tandarts', title: 'tandarts', startsAt: soon(30) }] };
      if (app === 'calendar' && op === 'listEvents' && args.circleId === 'club') return { items: [{ id: 'e2', label: 'wo 19:00 · training', title: 'training', startsAt: soon(5) }] };
      if (app === 'calendar' && op === 'listEvents' && !args.circleId) return { items: [{ id: 'e3', label: 'hardlopen', title: 'hardlopen', startsAt: soon(10) }] };
      return { items: [] };
    },
  };
}

describe('the items block', () => {
  it('task/mine across circles; the old tasks block reads the same', async () => {
    const [items, old] = await materializeScreen({ screen: { blocks: [{ id: 'a', type: 'items', config: { noun: 'task', scope: 'mine' } }, { id: 'b', type: 'tasks' }] }, hostOps: hostOps() });
    for (const b of [items, old]) {
      expect(b.type).toBe('items');
      expect(b.content.noun).toBe('task');
      expect(b.content.items.map((i) => [i.label, i.circleName])).toEqual([['afwas', 'Thuis']]);
    }
  });

  it('calendar-event: the circles\' appointments and my own, soonest first; the old calendar block reads the same', async () => {
    const [items, old] = await materializeScreen({ screen: { blocks: [{ id: 'a', type: 'items', config: { noun: 'calendar-event' } }, { id: 'b', type: 'calendar' }] }, hostOps: hostOps() });
    for (const b of [items, old]) {
      expect(b.type).toBe('items');
      expect(b.content.items.map((i) => i.label)).toEqual(['wo 19:00 · training', 'hardlopen', 'do 10:00 · tandarts']);
      expect(b.content.items.find((i) => i.label === 'hardlopen').circleId).toBe(null);
    }
  });
});
