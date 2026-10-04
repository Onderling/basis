/**
 * What a connected screen paints: the granted ops, grouped as `/help` groups them, each with the person's words for
 * it, a form when it has required params, and the op's confirm when it declares one (the surface asks; the waist does
 * not). An op the grant does not name is not painted, nor one the screen's code does not know.
 */
import { describe, it, expect } from 'vitest';
import { screenPanels, screenPanelsForGrant, screenPickerFetcher } from '../../src/v2/screenPaint.js';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { botOpLevel } from '../../src/v2/botOpMap.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const t = (k) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], nl); return typeof v === 'string' ? v : k; };
const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
const isAdmin = (entry) => (entry.appOrigin === 'assistant' ? entry.op?.visibility === 'trusted' : botOpLevel(entry.op?.id) === 'trusted');

describe('the screen\'s panels', () => {
  it('grouped, in the person\'s words, a form where params are required, the declared confirm', () => {
    const panels = screenPanels({ ops: ['lists.addToList', 'lists.listLists', 'lists.removeList', 'assistant.assistant-overview', 'calendar.addEvent', 'nope.nothing'], catalogue, isAdmin, t });
    expect(panels.map((p) => p.title)).toEqual(['Lijsten', 'Agenda', 'Jij', 'Voor de beheerder']);
    const lists = panels[0].items;
    expect(lists.map((i) => i.skill)).toEqual(['lists.addToList', 'lists.listLists']);
    expect(lists[0]).toMatchObject({ label: expect.stringContaining('iets op een lijst zetten'), needsForm: true });
    expect(lists[1]).toMatchObject({ needsForm: false, confirm: null });
    const admin = panels.at(-1).items;
    expect(admin[0]).toMatchObject({ skill: 'lists.removeList', confirm: expect.objectContaining({ severity: 'danger' }) });
    expect(JSON.stringify(panels)).not.toContain('nope.nothing');
    // the household's settings: the screen asks only for the two changes that take something from everyone
    const settings = screenPanels({ ops: ['assistant.assistant-settings'], catalogue, isAdmin, t })[0].items[0];
    expect(settings.confirm.when).toEqual(['names none', 'reminders off']);
  });

  it('on the screen the admin\'s things come first, then the lists, chores and agenda (Frits, 2026-10-04)', () => {
    const panels = screenPanelsForGrant(['lists.addToList', 'lists.removeList', 'assistant.assistant-users', 'calendar.addEvent'], t);
    expect(panels[0].title).toBe('Voor de beheerder');
    expect(panels.map((p) => p.title)).toEqual(['Voor de beheerder', 'Lijsten', 'Agenda']);
  });
});

describe('a field the screen can fill in: its source, read through the screen\'s own grant', () => {
  const calls = [];
  const fetcher = screenPickerFetcher({
    call: async (skill, args) => { calls.push({ skill, args }); return { items: [{ id: 'l1', label: 'Boodschappen' }, { id: 'l2', title: 'Klusjes' }, { label: 'geen id' }] }; },
    ops: () => ['lists.listLists'],
    appOrigin: 'lists',
  });
  it('the declared read, its items as choices (the id the value, the words the label)', async () => {
    expect(await fetcher({ listOp: 'listLists', appOrigin: 'lists' })).toEqual([{ id: 'l1', label: 'Boodschappen' }, { id: 'l2', label: 'Klusjes' }]);
    expect(await fetcher({ listOp: 'listLists' })).toHaveLength(2);   // the field's own app when the source names none
  });
  it('a read the screen holds no token for: nothing to pick (it never asks)', async () => {
    const before = calls.length;
    expect(await fetcher({ listOp: 'listEvents', appOrigin: 'calendar' })).toEqual([]);
    expect(calls.length).toBe(before);
  });
});
