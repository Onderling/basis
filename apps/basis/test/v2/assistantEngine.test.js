/**
 * assistantEngine — the one composition: gate, retrieval, per-thread memory, interpreter. The model is
 * stateless, so what it sees per call is exactly what this module hands it.
 */
import { describe, it, expect } from 'vitest';
import { mergeManifests } from '../../src/manifestMerge.js';
import { mockHouseholdManifest } from '../../src/core/agent/mockAgent.js';
import { createAssistantEngine, loadAssistantItems } from '../../src/v2/assistantEngine.js';

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
    await e.handle('a', 'boodschappen');
    await e.handle('b', 'boodschappen');
    expect(seen[0].context).toEqual(['you: welke lijst?', 'assistant: Welke lijst bedoel je — boodschappen of klusjes?']);
    expect(seen[1].context).toEqual([]);
    expect(dispatched).toHaveLength(2);
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
    await e.handle('t', 'melk');
    const lines = (seen[0] ?? []).map((c) => (c?.entry ?? c)?.text ?? c);
    expect(lines.join(' ')).toContain('melk');
  });
  it('without a model the gate still routes a verb and free text reports llm-unavailable', async () => {
    const dispatched = [];
    const unavailable = [];
    const e = createAssistantEngine({ catalogue, dispatch: (i) => dispatched.push(i), lang: 'en', onLlmUnavailable: () => unavailable.push(1) });
    expect(e.smart).toBe(false);
    const r = await e.handle('t', 'what is the weather');
    expect(r.via).toBe('llm-unavailable');
    expect(unavailable).toHaveLength(1);
  });
  it('loadAssistantItems shapes household open items for the retriever', async () => {
    const load = loadAssistantItems({ callSkill: async () => ({ items: [{ id: 9, type: 'shopping', label: 'Milk' }, { id: 10, text: '' }] }) });
    expect(await load()).toEqual([{ id: '9', type: 'shopping', text: 'Milk' }]);
  });
});
