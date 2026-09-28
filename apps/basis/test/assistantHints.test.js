/**
 * The model reads its tools in the member's language, with a steady hand, and one hiccup does not end the turn.
 *
 *   - Every chat op in the household scope has a Dutch hint (`locales/chat-hints.nl.json`, `<app>.<op>`, `{text, doc}`); a Dutch thread's tools read "<Dutch> (<English>)", an English thread's the reverse — the
 *     English stays, it is what the prompt's rules speak.
 *   - The interpreter is called with a pinned temperature (`assistant.temperature`), no `tool_choice`.
 *   - A timeout on the primary model is retried ONCE on the fallback model (`assistant.fallbackModel`), and the
 *     box is told (the walk log's trail).
 */
import { describe, it, expect } from 'vitest';
import { buildToolDescriptors } from '../src/v2/interpretCommand.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { buildAssistantLlm } from '../src/telegram/assistantLlm.js';
import { chatHintFor } from '../src/v2/chatHints.js';
import { listsManifest } from '../../lists/manifest.js';

const catalogue = mergeManifests([{ manifest: listsManifest }]);

describe('tool hints in the member\'s language', () => {
  it('Dutch first for a Dutch thread, English first for an English one; the other in brackets', () => {
    const nl = buildToolDescriptors(catalogue, { lang: 'nl', hintFor: chatHintFor }).find((x) => x.id === 'createList');
    const en = buildToolDescriptors(catalogue, { lang: 'en', hintFor: chatHintFor }).find((x) => x.id === 'createList');
    const dutch = chatHintFor('lists', 'createList', 'nl');
    expect(dutch, 'the Dutch hint exists').toBeTruthy();
    expect(nl.description).toBe(`${dutch} (Start a new list in this circle.)`);
    expect(en.description).toBe(`Start a new list in this circle. (${dutch})`);
    // without a language or a lookup: the manifest's own hint, as before
    expect(buildToolDescriptors(catalogue).find((x) => x.id === 'createList').description).toBe('Start a new list in this circle.');
  });

  it('the engine hands the interpreter the thread\'s language and a pinned temperature', async () => {
    const seen = [];
    const engine = createAssistantEngine({
      catalogue, dispatch: async () => ({}), lang: 'nl', llm: { invoke: async () => ({ text: 'ok' }) },
      interpret: async (text, o = {}) => { seen.push(o); return null; }, collectMs: 0,
      threadLang: (id) => (id === 'en-thread' ? 'en' : null),
    });
    await engine.ask('nl-thread', 'hoe is het nu met de lijst van ons');   // a line the gate does not take
    await engine.idle();
    await engine.ask('en-thread', 'put bread on the list');
    await engine.idle();
    expect(seen[0].options).toMatchObject({ temperature: 0.2 });
    expect(seen[0].options.tool_choice).toBeUndefined();
    expect(seen[0].toolLang).toBe('nl');
    expect(seen[1].toolLang).toBe('en');
  });
});

describe('one fallback on a timeout', () => {
  it('the primary times out → the fallback model answers once, and the box is told', async () => {
    const calls = [];
    const fell = [];
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    const built = await buildAssistantLlm({
      hasKey: () => 'k',
      makeProvider: async ({ model }) => ({
        model: model ?? 'primary-model',
        invoke: async () => { calls.push(model ?? 'primary-model'); if (!model || model === 'primary-model') throw abort; return { text: 'from the fallback' }; },
      }),
      onFallback: (e) => fell.push(e),
    });
    const r = await built.llm.invoke({ system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(r.text).toBe('from the fallback');
    expect(calls).toEqual(['primary-model', 'gpt-oss-120b']);
    expect(fell).toEqual([{ from: 'primary-model', to: 'gpt-oss-120b', reason: 'timeout' }]);
  });

  it('any other error is not retried', async () => {
    const calls = [];
    const built = await buildAssistantLlm({
      hasKey: () => 'k',
      makeProvider: async ({ model }) => ({ model: model ?? 'p', invoke: async () => { calls.push(model ?? 'p'); throw new Error('400 bad request'); } }),
    });
    await expect(built.llm.invoke({ system: 's', messages: [] })).rejects.toThrow('400');
    expect(calls).toEqual(['p']);
  });
});
