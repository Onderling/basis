/**
 * The household on a screen: the lists with their lines, read through the read ops the screen holds (never a mirror of
 * the bot's history), each line with the actions its type takes — from the ops' own `appliesTo`, only those the screen
 * holds a token for, only those a line can fill (its id), each with a short word and the op's own confirm.
 */
import { describe, it, expect } from 'vitest';
import { readHousehold } from '../src/v2/screenHousehold.js';
import { screenActionForm, screenPanelsForGrant } from '../src/v2/screenPaint.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);
const reads = {
  'lists.listLists': { ok: true, items: [{ id: 'L1', label: 'Boodschappen', type: 'list' }, { id: 'L2', label: 'Klusjes', type: 'list' }, { id: 'L3', label: 'Agenda', type: 'list' }] },
  'lists.listEntries:Boodschappen': { ok: true, title: 'Boodschappen', items: [{ id: 'e1', label: 'melk', type: 'list-item' }] },
  'lists.listEntries:Klusjes': { ok: true, title: 'Klusjes', items: [{ id: 't1', label: 'ramen — open', type: 'task', state: 'open' }, { id: 't2', label: 'vuilnis — Ann', type: 'task', state: 'claimed' }] },
  'lists.listEntries:Agenda': { ok: true, title: 'Agenda', items: [{ id: 'c1', label: 'tandarts do 10:00', type: 'calendar-event' }] },
  'assistant.assistant-users': { ok: true, message: 'Ann — admin\nBert — member', items: [{ id: 'telegram:1', label: 'Ann', role: 'admin', linked: false }, { id: 'telegram:7', label: 'Bert', role: 'member', linked: false }] },
};
const call = async (skill, args) => reads[skill === 'lists.listEntries' ? `${skill}:${args.list}` : skill] ?? { ok: false };
const MEMBER = ['lists.listLists', 'lists.listEntries', 'lists.markListItemDone', 'lists.removeFromList', 'tasks.claimTask', 'tasks.completeTask', 'calendar.rsvpAccept', 'calendar.rsvpDecline', 'calendar.cancelEvent'];

describe('readHousehold — the household on a screen', () => {
  it('each list with its lines, in order', async () => {
    const h = await readHousehold({ call, ops: MEMBER, t });
    expect(h.lists.map((l) => l.title)).toEqual(['Boodschappen', 'Klusjes', 'Agenda']);
    expect(h.lists[0].items.map((i) => i.label)).toEqual(['melk']);
  });

  it('a line\'s actions are its type\'s ops the screen holds, filled from the line', async () => {
    const h = await readHousehold({ call, ops: MEMBER, t });
    const melk = h.lists[0].items[0];
    expect(melk.actions.map((a) => a.skill)).toEqual(['lists.markListItemDone', 'lists.removeFromList']);
    expect(melk.actions[0].args).toEqual({ item: 'e1', list: 'Boodschappen' });
    const [ramen, vuilnis] = h.lists[1].items;
    expect(ramen.actions.map((a) => a.skill)).toEqual(['tasks.claimTask']);         // open: claim, not complete
    expect(vuilnis.actions.map((a) => a.skill)).toEqual(['tasks.completeTask']);    // held: complete
    expect(ramen.actions[0].args).toEqual({ id: 't1' });
    const tandarts = h.lists[2].items[0];
    expect(tandarts.actions.map((a) => a.skill)).toEqual(['calendar.rsvpAccept', 'calendar.rsvpDecline', 'calendar.cancelEvent']);
    expect(tandarts.actions.find((a) => a.skill === 'calendar.cancelEvent').confirm).toBeTruthy();
    for (const a of [...melk.actions, ...ramen.actions, ...tandarts.actions]) expect(a.label).toMatch(/^circle\.connectScreen\.action\./);
  });

  it('an op the screen holds no token for gives no action', async () => {
    const h = await readHousehold({ call, ops: ['lists.listLists', 'lists.listEntries'], t });
    for (const l of h.lists) for (const i of l.items) expect(i.actions).toEqual([]);
  });

  it('an op on a line that needs more than the line (an edit\'s words, a reassign\'s person) is still the line\'s: its form asks the rest', async () => {
    const h = await readHousehold({ call, ops: ['lists.listLists', 'lists.listEntries', 'tasks.reassignTask', 'lists.editEntry'], t });
    const melk = h.lists[0].items[0];
    expect(melk.actions.map((a) => [a.skill, a.args])).toEqual([['lists.editEntry', { item: 'e1', list: 'Boodschappen' }]]);
    const ramen = h.lists[1].items[0];
    expect(ramen.actions.map((a) => [a.skill, a.args])).toEqual([['tasks.reassignTask', { id: 't1' }]]);
    expect(screenActionForm('tasks.reassignTask', { id: 't1' }).missing).toEqual(['newAssignee']);
    expect(screenActionForm('lists.editEntry', { item: 'e1', list: 'Boodschappen' }).missing).toEqual(['text']);
  });

  it('the rule, one predicate for both: an op on a line is never a standalone form on the screen; an add is', () => {
    const skills = ['lists.addToList', 'lists.createList', 'calendar.addEvent', 'lists.markListItemDone', 'lists.removeFromList', 'lists.editEntry', 'tasks.claimTask', 'tasks.completeTask', 'tasks.reassignTask', 'tasks.removeTask', 'calendar.rsvpAccept', 'calendar.cancelEvent'];
    const painted = screenPanelsForGrant(skills, t).flatMap((p) => p.items.map((i) => i.skill));
    expect(painted.sort()).toEqual(['calendar.addEvent', 'lists.addToList', 'lists.createList']);
  });

  it('the people only when the screen holds the users read', async () => {
    expect((await readHousehold({ call, ops: MEMBER, t })).people).toBeNull();
    // the rows of the one read (painted as rows on the screen, each with the actions the screen holds — none here)
    expect((await readHousehold({ call, ops: [...MEMBER, 'assistant.assistant-users'], t })).people.map((p) => [p.label, p.role, p.actions.length])).toEqual([['Ann', 'admin', 0], ['Bert', 'member', 0]]);
  });

  it('no lists read: nothing to show', async () => {
    expect(await readHousehold({ call, ops: ['tasks.claimTask'], t })).toEqual({ lists: [], people: null });
  });
});

describe('FITNESS: every line action has a short word', () => {
  it('in nl and en', async () => {
    const { lineActionOps } = await import('../src/v2/screenHousehold.js');
    const nl = (await import('../src/locales/circle.nl.json', { with: { type: 'json' } })).default;
    const en = (await import('../src/locales/circle.en.json', { with: { type: 'json' } })).default;
    const missing = lineActionOps().flatMap((op) => [['nl', nl], ['en', en]].filter(([, b]) => typeof b?.connectScreen?.action?.[op] !== 'string').map(([l]) => `${l}: ${op}`));
    expect(missing).toEqual([]);
    // an op on a line that asks more than the line (an edit, a reassign) is the line's too: its form asks the rest
    expect(lineActionOps()).toEqual(expect.arrayContaining(['editTask', 'editEntry', 'reassignTask']));
  });
});
