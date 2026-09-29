/**
 * What the household bot's model sees, per person — and the gate holds the same line.
 *
 * Three plugins, three concerns, no overlap: lists HOLD (make · list · add · done · remove · edit), tasks MOVE (a task's
 * claim · complete · reassign · edit · remove, and "mine"), the assistant's own ops set a person's thread. A member's
 * thread offers about eleven tools, an admin's a few more; the tasks app's ~50 ops and household's item ops never
 * reach a descriptor. The same map decides at the gate: a member cannot run an admin's op, and an op off the map is
 * refused however it is asked for. The deterministic gate speaks the lists: "zet melk op de boodschappen" is addToList.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { buildToolDescriptors } from '../src/v2/interpretCommand.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { BOT_OP_MAP, botOpLevel, scopeCatalogueToRole, roleHintsFor } from '../src/v2/botOpMap.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { HOUSEHOLD_TEMPLATE } from '../src/v2/householdTemplate.js';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const nodes = [];
afterAll(() => teardown(nodes));

const MEMBER = ['listLists', 'listEntries', 'addToList', 'markListItemDone', 'removeFromList', 'editEntry', 'listMine', 'claimTask', 'completeTask', 'addEvent', 'listEvents', 'rsvpAccept', 'rsvpDecline', 'rsvpTentative', 'assistant-memory', 'assistant-language'];
const ADMIN_EXTRA = ['createList', 'reassignTask', 'removeTask', 'editTask', 'cancelEvent'];

describe('the bot\'s slim map', () => {
  const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
  const tools = (role) => buildToolDescriptors(scopeCatalogueToRole(catalogue, role)).map((t) => t.id).sort();

  it('a member\'s thread offers exactly the member ops; an admin\'s adds the admin ops', () => {
    expect(tools('member')).toEqual([...MEMBER].sort());
    expect(tools('admin')).toEqual([...MEMBER, ...ADMIN_EXTRA].sort());
    expect(BOT_OP_MAP.member).toEqual(MEMBER);
  });

  it('each op has its level; an op off the map has none', () => {
    expect(botOpLevel('addToList')).toBe('authenticated');
    expect(botOpLevel('reassignTask')).toBe('trusted');
    expect(botOpLevel('addItem')).toBeNull();
    expect(botOpLevel('provisionMyCircle')).toBeNull();
  });

  it('the gate holds the map: an admin op is refused to a member, an op off the map to everyone', async () => {
    const node = await bootRealAgentNode('slim', { agentOpts: { doorOpLevel: botOpLevel } });
    nodes.push(node);
    const { agent } = node;
    await agent.setDoorCaller('telegram:1', 'member');
    await agent.setDoorCaller('telegram:2', 'admin');
    expect(await agent.doorRefusal('addToList', 'telegram:1')).toBeNull();
    expect(await agent.doorRefusal('reassignTask', 'telegram:1')).toBeTruthy();
    expect(await agent.doorRefusal('reassignTask', 'telegram:2')).toBeNull();
    expect(await agent.doorRefusal('addItem', 'telegram:2')).toBeTruthy();
    const r = await agent.callSkill('household', 'addItem', { type: 'shopping', text: 'x' }, { caller: 'telegram:2' });
    expect(r).toMatchObject({ ok: false });
  }, 90_000);

  it('the deterministic gate speaks the lists', () => {
    const nameOf = (kind) => ({ shopping: 'Boodschappen', errand: 'Klusjes', repair: 'Reparaties', schedule: 'Agenda' }[kind]);
    const rules = listsGateRules('nl', nameOf);
    const run = (text) => { for (const r of rules) { const ok = typeof r.test === 'function' ? r.test(text) : r.test.test(text); if (ok) { const c = r.command(text, {}); if (c) return c; } } return null; };
    expect(run('zet melk op de boodschappen')).toMatchObject({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } });
    expect(run('wat staat er op de boodschappen')).toMatchObject({ opId: 'listEntries', args: { list: 'Boodschappen' } });
    expect(run('add task call the plumber')).toMatchObject({ opId: 'addToList', args: { list: 'Klusjes', text: 'call the plumber' } });
    expect(run('nieuwe taak: lamp vervangen')).toMatchObject({ opId: 'addToList', args: { list: 'Klusjes', text: 'lamp vervangen' } });
    expect(HOUSEHOLD_TEMPLATE.lists.map((l) => l.kind)).toEqual(['shopping', 'errand', 'repair', 'schedule']);
  });

  it('a member\'s model is told which tools are the admin\'s, so "maak een lijst" gets "the admin does that"', () => {
    const [line] = roleHintsFor('member');
    for (const op of BOT_OP_MAP.admin) expect(line).toContain(op);
    expect(roleHintsFor('admin')).toEqual([]);
    // with the door's translator, the model is handed the refusal sentence itself — the locale's words, not its own
    const [said] = roleHintsFor('member', (k) => (k === 'circle.bot.admin_only' ? 'Dat kan alleen de beheerder van deze bot.' : k));
    expect(said).toContain('Dat kan alleen de beheerder van deze bot.');
    expect(roleHintsFor(null)).toEqual([]);
  });
});
