/**
 * Reminders count from a type's TIME ANCHOR (`timeAnchorOf`): appointments from `startsAt`, chores from `dueAt` (the
 * frozen table), and any declared scheduled noun from its own moment — a plant from `waterAt` — with no reminder code
 * for it. A noun the node does not know a moment for gets none.
 */
import { describe, it, expect } from 'vitest';
import { reminderOccurrences } from '../src/v2/reminderOccurrences.js';
import { plantsManifest } from '../../example-plants/manifest.js';

const tz = 'Europe/Amsterdam';
const now = Date.parse('2026-10-20T05:00:00Z');   // 07:00 local, before the morning message
const plant = { id: 'p1', type: 'plants.plant', body: 'Monstera', waterAt: '2026-10-20T14:00:00Z' };
const people = [{ id: 'ann' }, { id: 'bob' }];

describe('reminders by a type\'s anchor', () => {
  it('a declared scheduled noun is reminded from its own moment, for everyone, worded by its label', () => {
    const occ = reminderOccurrences({ others: [plant], manifests: [plantsManifest], people, now, tz, rulesFor: () => ['morning'], horizon: 86_400_000 });
    expect(occ.map((o) => [o.itemId, o.personId, o.rule, o.text])).toEqual([['p1', 'ann', 'morning', 'Monstera'], ['p1', 'bob', 'morning', 'Monstera']]);
    expect(occ[0].anchor).toBe(plant.waterAt);
  });

  it('without its declaration there is no moment: no reminder', () => {
    expect(reminderOccurrences({ others: [plant], people, now, tz, rulesFor: () => ['morning'], horizon: 86_400_000 })).toEqual([]);
  });

  it('appointments and chores keep their moments (the frozen table, read through the same anchor)', () => {
    const occ = reminderOccurrences({
      events: [{ id: 'e1', title: 'Tandarts', startsAt: '2026-10-20T14:00:00Z' }],
      chores: [{ id: 'c1', text: 'Vuilnis', dueAt: '2026-10-20T14:00:00Z', assignee: 'ann' }],
      people, now, tz, rulesFor: () => ['morning'], horizon: 86_400_000,
    });
    expect(occ.map((o) => `${o.kind}:${o.itemId}:${o.personId}`).sort()).toEqual(['chore:c1:ann', 'event:e1:ann', 'event:e1:bob']);
  });
});

describe('the bot\'s reminder sources carry an installed extension\'s scheduled rows', () => {
  it('a plant in the home circle comes with its declaration, and the bot\'s pass reminds of it', async () => {
    const { createRealHouseholdAgent } = await import('../src/core/agent/realAgent.js');
    const { PERSON_NODE_STORE_OPTS } = await import('../src/v2/personNodeStore.js');
    const { encodeGenericOpId } = await import('@onderling/app-manifest');
    const { dueReminders } = await import('../src/v2/botReminders.js');
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, extensions: [{ origin: 'plants', manifest: plantsManifest }] });
    const made = await a.callSkill('plants', encodeGenericOpId('plants', 'add', 'plants.plant'), { body: 'Monstera', waterAt: '2026-10-20T14:00:00Z' });
    expect(made?.ok, JSON.stringify(made)).not.toBe(false);
    const src = await a.reminderSources();
    expect(src.others.map((r) => r.body)).toEqual(['Monstera']);
    const at = Date.parse('2026-10-20T06:30:00Z');   // the morning message's slot, local
    const due = dueReminders({ ...src, people: [{ id: 'ann' }], now: at, tz, rulesFor: () => ['morning'] });
    expect(due.flatMap((d) => d.items.map((i) => i.text))).toEqual(['Monstera']);
  });
});
