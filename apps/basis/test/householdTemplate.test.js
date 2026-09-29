/**
 * A household bot starts with the household's lists: Boodschappen · Klusjes · Reparaties · Agenda.
 *
 * Household's four "lists" were app-local item types and its chores a copy of the tasks app. They become lists of
 * the lists feature: the bot makes the four on its FIRST start (no lists at all), Klusjes making tasks when a bare
 * add names no kind. A list someone later deletes or renames is not made again — the template is a start, not a
 * rule. Through a real agent: the lists ops on its waist.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { ensureHouseholdLists, HOUSEHOLD_TEMPLATE } from '../src/v2/householdTemplate.js';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { listsManifest } from '../../lists/manifest.js';

const nodes = [];
afterAll(() => teardown(nodes));
const names = (r) => (r?.items ?? r?.lists ?? r ?? []).map((l) => l.text ?? l.label ?? l.name);

describe('the household template', () => {
  it('a bot with no lists gets the four; Klusjes makes tasks; a second start adds nothing', async () => {
    const node = await bootRealAgentNode('tpl');
    nodes.push(node);
    const call = (app, op, args) => node.agent.callSkill(app, op, args);
    const t = (k) => ({ 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' }[k] ?? k);
    const made = await ensureHouseholdLists({ callSkill: call, t });
    expect(made).toEqual(['Boodschappen', 'Klusjes', 'Reparaties', 'Agenda']);
    expect(names(await call('lists', 'listLists', {}))).toEqual(expect.arrayContaining(['Boodschappen', 'Klusjes', 'Reparaties', 'Agenda']));
    const chore = await call('lists', 'addToList', { list: 'Klusjes', text: 'band plakken' });
    expect(chore.ok, JSON.stringify(chore)).toBe(true);
    const shop = await call('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    expect(shop.ok).toBe(true);
    const tree = await call('lists', 'listLists', {});
    expect(JSON.stringify(tree)).not.toContain('"error"');
    // the kinds: a task on Klusjes, a plain entry on Boodschappen
    expect(chore.kind ?? chore.type).toBe('task');
    expect(shop.kind ?? shop.type).toBe('list-item');
    expect(await ensureHouseholdLists({ callSkill: call, t }), 'a second start adds nothing').toEqual([]);
  }, 90_000);

  it('the template is data: its lists, no required fields for a chore, and what the model is told', () => {
    expect(HOUSEHOLD_TEMPLATE.lists.map((l) => l.defaultChild ?? null)).toEqual([null, 'task', null, 'calendar-event']);
    expect(HOUSEHOLD_TEMPLATE.required).toEqual({});
    expect(HOUSEHOLD_TEMPLATE.promptLines.join(' ')).toMatch(/addToList/);
    expect(HOUSEHOLD_TEMPLATE.promptLines.join(' ')).not.toMatch(/addItem|addTask/);
  });

  it('what the template tells the model reaches the model: the engine\'s stable prompt carries its lines', async () => {
    const seen = [];
    const engine = createAssistantEngine({
      catalogue: mergeManifests([{ manifest: listsManifest }]), dispatch: async () => ({}), lang: 'nl', collectMs: 0,
      llm: { invoke: async () => ({ text: 'ok' }) }, interpret: async (text, o = {}) => { seen.push(o.system); return null; },
      promptLines: HOUSEHOLD_TEMPLATE.promptLines,
    });
    await engine.ask('t1', 'hoe is het nu met de lijst van ons');
    await engine.idle();
    expect(seen[0]).toContain(HOUSEHOLD_TEMPLATE.promptLines[0]);
  });
});
