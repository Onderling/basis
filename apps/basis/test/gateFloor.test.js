/**
 * The deterministic floor (Fable, 2026-10-01): the household bot's everyday sentences work without a model. Exact
 * imperative rules — the words go to the waist, the resolver finds one item or asks — and a bounded date reader for
 * appointments and chores with a day. A sentence the rules do not know stays the model's.
 */
import { describe, it, expect } from 'vitest';
import { listsGateRules } from '../src/v2/circleGate.js';
import { templateLists } from '../src/v2/householdTemplate.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const rules = listsGateRules('nl', templateLists((k) => NAMES[k] ?? k));
const run = (text) => { for (const r of rules) { const ok = typeof r.test === 'function' ? r.test(text) : r.test.test(text); if (ok) { const c = r.command(text, {}); if (c) return c; } } return null; };

describe('the deterministic floor', () => {
  it('chores in a person\'s words', () => {
    expect(run('ik doe de ramen')).toMatchObject({ opId: 'claimTask', args: { id: 'ramen' } });
    expect(run('wat moet ik nog doen')).toMatchObject({ opId: 'listMine' });
    expect(run('Wat moet ik doen?')).toMatchObject({ opId: 'listMine' });
    expect(run('ik doe mee')).toBeNull();
    expect(run('ik doe het morgen')).toBeNull();
  });

  it('removing an entry, making a list', () => {
    expect(run('haal melk van de lijst')).toMatchObject({ opId: 'removeFromList', args: { item: 'melk' } });
    expect(run('haal de melk van de boodschappen')).toMatchObject({ opId: 'removeFromList', args: { item: 'melk' } });
    expect(run('maak een lijst werk')).toMatchObject({ opId: 'createList', args: { text: 'werk' } });
    expect(run('maak een nieuwe lijst Vakantie')).toMatchObject({ opId: 'createList', args: { text: 'Vakantie' } });
  });

  it('appointments with a day and a time', () => {
    const c = run('tandarts morgen om 10 uur');
    expect(c).toMatchObject({ opId: 'addEvent', appOrigin: 'calendar', args: { title: 'tandarts' } });
    expect(c.args.when).toMatch(/^\d{4}-\d{2}-\d{2}T10:00$/);
    expect(run('Kapper vrijdag om half 3')).toMatchObject({ opId: 'addEvent', args: { title: 'Kapper' } });
    // not an appointment: a sentence about oneself, or no time
    expect(run('ik ben morgen om 10 uur weg')).toBeNull();
    expect(run('tandarts morgen')).toBeNull();
  });

  it('a chore that says who and when', () => {
    const c = run('nieuwe taak voor mij: ramen lappen, morgen');
    expect(c).toMatchObject({ opId: 'addToList', args: { list: 'Klusjes', text: 'ramen lappen', assignee: 'mij' } });
    expect(c.args.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(run('nieuwe taak voor Bert: vuilnis')).toMatchObject({ opId: 'addToList', args: { text: 'vuilnis', assignee: 'Bert' } });
    // a day that is not read stays the model's
    expect(run('nieuwe taak voor mij: ramen, eind van de maand')).toBeNull();
  });
});

describe('a rule that may fall back to the model', () => {
  it('words that name nothing go to the model when there is one; without a model the refusal stands', async () => {
    const { createTelegramRunner } = await import('../src/telegram/runner.js');
    const { InMemoryBridge } = await import('@onderling/chat-agent');
    const { LlmClient, mockProvider } = await import('@onderling/llm-client');
    const { mergeManifests } = await import('../src/manifestMerge.js');
    const { mockTasksManifest } = await import('../src/core/manifests/mockManifests.js');
    const catalogue = mergeManifests([{ manifest: mockTasksManifest }]);
    const callSkill = async (_app, op) => (op === 'claimTask' ? { ok: false, code: 'not-found', error: 'Geen klusje "afwas".' } : { ok: true });
    const boot = async (llm) => {
      const bridge = new InMemoryBridge({ id: 'telegram' });
      const asked = [];
      const { interpretToCommand } = await import('../src/v2/interpretCommand.js');
      const runner = createTelegramRunner({ bridge, t: (k) => k, collectMs: 0, catalogue, callSkill, gateRules: rules, interpret: interpretToCommand,
        llm: llm ? new LlmClient({ provider: mockProvider({ script: [{ when: 'afwas', replyText: 'Bedoel je de vaat?' }], onRequest: (r) => asked.push(r) }) }) : null });
      await runner.start();
      await bridge.simulateIncoming({ chatId: '12', text: 'ik doe de afwas', sender: { bridgeUid: '12' } });
      await runner.idle();
      return { said: bridge.outbox.map((m) => m.text).join('\n'), asked };
    };
    const withModel = await boot(true);
    expect(withModel.asked.length).toBe(1);
    expect(withModel.said).toContain('Bedoel je de vaat?');
    expect(withModel.said).not.toContain('Geen klusje');
    const without = await boot(false);
    expect(without.said).toContain('Geen klusje');
  });
});
