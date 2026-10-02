/**
 * What a connected screen paints: the granted ops, grouped as `/help` groups them, each with the person's words for
 * it, a form when it has required params, and the op's confirm when it declares one (the surface asks; the waist does
 * not). An op the grant does not name is not painted, nor one the screen's code does not know.
 */
import { describe, it, expect } from 'vitest';
import { screenPanels } from '../../src/v2/screenPaint.js';
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
});
