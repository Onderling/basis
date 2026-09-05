/**
 * assistantEngine — the one composition: gate, retrieval, per-thread memory, interpreter. The model is
 * stateless, so what it sees per call is exactly what this module hands it.
 */
import { describe, it, expect } from 'vitest';
import { mergeManifests } from '../../src/manifestMerge.js';
import { mockHouseholdManifest } from '../../src/core/agent/mockAgent.js';
import { createAssistantEngine, loadAssistantItems, interpretSystemFor } from '../../src/v2/assistantEngine.js';

const catalogue = mergeManifests([{ manifest: mockHouseholdManifest }]);
const llm = { invoke: async () => null };

describe('createAssistantEngine', () => {
  it('re-sends the thread\'s recent turns to the interpreter, per thread', async () => {
    const seen = [];
    const interpret = async (text, { context }) => { seen.push({ text, context }); return { opId: 'listOpen', args: {} }; };
    const dispatched = [];
    const e = createAssistantEngine({ catalogue, dispatch: (i) => dispatched.push(i), llm, interpret });
    e.remember('a', 'you', 'welke lijst?');
    e.remember('a', 'assistant', 'Welke lijst bedoel je — boodschappen of klusjes?');
    await e.ask('a', 'boodschappen');
    await e.ask('b', 'boodschappen');
    expect(seen[0].context).toEqual(['you: welke lijst?', 'assistant: Welke lijst bedoel je — boodschappen of klusjes?']);
    expect(seen[1].context).toEqual([]);
    expect(dispatched).toHaveLength(2);
  });
  it('three voices: you, assistant, system — an op result is never the assistant speaking', () => {
    const e = createAssistantEngine({ catalogue, dispatch: () => {} });
    e.remember('t', 'you', 'zet kaas op de lijst');
    e.remember('t', 'system', '✓ added to shopping: kaas');
    e.remember('t', 'assistant', 'Nog iets?');
    expect(e.recentTurns('t')).toEqual(['you: zet kaas op de lijst', 'system: ✓ added to shopping: kaas', 'assistant: Nog iets?']);
  });

  it('memory is bounded to the last N turns', () => {
    const e = createAssistantEngine({ catalogue, dispatch: () => {}, memoryTurns: 3 });
    for (let i = 0; i < 5; i += 1) e.remember('t', 'you', `turn ${i}`);
    expect(e.recentTurns('t')).toEqual(['you: turn 2', 'you: turn 3', 'you: turn 4']);
  });
  it('retrieval draws on loadItems and reaches the interpreter as context (lexical, no embedder)', async () => {
    const seen = [];
    const interpret = async (text, { context }) => { seen.push(context); return null; };
    const loadItems = async () => [{ id: '1', type: 'shopping', text: 'melk' }, { id: '2', type: 'shopping', text: 'kaas' }, { id: '3', type: 'task', text: 'stofzuigen' }];
    const e = createAssistantEngine({ catalogue, dispatch: () => {}, llm, interpret, loadItems, onNoMatch: () => {} });
    // lexical retrieval matches on the item's words (a full question is the embedder's job — semantic tier)
    await e.ask('t', 'melk');
    const lines = (seen[0] ?? []).map((c) => (c?.entry ?? c)?.text ?? c);
    expect(lines.join(' ')).toContain('melk');
  });
  it('without a model the gate still routes a verb and free text reports llm-unavailable', async () => {
    const dispatched = [];
    const unavailable = [];
    const e = createAssistantEngine({ catalogue, dispatch: (i) => dispatched.push(i), lang: 'en', onLlmUnavailable: () => unavailable.push(1) });
    expect(e.smart).toBe(false);
    const r = await e.ask('t', 'what is the weather');
    expect(r.via).toBe('llm-unavailable');
    expect(unavailable).toHaveLength(1);
  });
  it('a circle door: handle() takes the raw line — an unaddressed group line is chat, not a bot turn', async () => {
    const posted = [];
    const interpret = async () => ({ opId: 'listOpen', args: {} });
    const dispatched = [];
    const e = createAssistantEngine({ catalogue, dispatch: (i) => dispatched.push(i), llm, interpret, postToCircle: (text) => posted.push(text) });
    const r1 = await e.handle('ik koop straks melk', { id: 'c1' });
    expect(r1.via).toBe('circle');
    expect(posted).toEqual(['ik koop straks melk']);
    const r2 = await e.handle('@assistant laat de lijst zien', { id: 'c1' });
    expect(r2.via).toBe('llm');
    expect(dispatched).toHaveLength(1);
  });
  it('the circle composers\' form: a policy getter, a user default and two providers, plus their own recentTurns', async () => {
    const seen = [];
    const interpret = async (text, { context }) => { seen.push(context); return null; };
    const e = createAssistantEngine({
      catalogue, dispatch: () => {}, interpret, onNoMatch: () => {},
      policy: async () => ({ llmTool: 'user' }), userDefault: () => ({ mode: 'cloud' }),
      llmProviders: { cloud: { invoke: async () => null } },
      recentTurns: () => ['you: hoi', 'assistant: hallo'],
    });
    expect(e.smart).toBe(true);
    await e.ask('c', 'iets');
    expect(seen[0]).toEqual(['you: hoi', 'assistant: hallo']);
  });
  it('the interpreter is told the language and the local add-phrasings (walk 2: an English greeting, "kun je … toevoegen" read as show)', async () => {
    const seen = [];
    const interpret = async (text, o) => { seen.push(o.system); return null; };
    const e = createAssistantEngine({ catalogue, dispatch: () => {}, llm, interpret, lang: 'nl', onNoMatch: () => {} });
    await e.ask('t', 'maii');
    expect(seen[0]).toContain('Always reply in Dutch');
    expect(seen[0]).toContain('voeg … toe');
    expect(interpretSystemFor('en')).toContain('Always reply in English');
  });

  it('loadAssistantItems shapes household open items for the retriever', async () => {
    const load = loadAssistantItems({ callSkill: async () => ({ items: [{ id: 9, type: 'shopping', label: 'Milk' }, { id: 10, text: '' }] }) });
    expect(await load()).toEqual([{ id: '9', type: 'shopping', text: 'Milk' }]);
  });
});
