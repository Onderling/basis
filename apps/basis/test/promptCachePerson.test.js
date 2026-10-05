/**
 * Prompt caching on the bot: each model call carries WHOSE turn it is (`cacheKey`, the person's thread), so the provider
 * gives each person their own cache (a salt derived from the box's secret); the box's secret reaches the provider; and
 * every call's token counts — the cached part included, never the words — reach the box's meter.
 */
import { describe, it, expect } from 'vitest';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { buildAssistantLlm } from '../src/telegram/assistantLlm.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { listsManifest } from '../../lists/manifest.js';

const catalogue = mergeManifests([{ manifest: listsManifest }]);

describe('the person rides with the model call', () => {
  it('interpretToCommand hands the provider the cacheKey', async () => {
    const reqs = [];
    await interpretToCommand('zet kaas op de lijst', { catalogue, llm: { invoke: async (req) => { reqs.push(req); return {}; } }, cacheKey: 'telegram:42' });
    expect(reqs[0].cacheKey).toBe('telegram:42');
  });

  it('the engine names the thread as the cache key', async () => {
    const seen = [];
    const engine = createAssistantEngine({
      catalogue, dispatch: async () => ({}), lang: 'nl', llm: { invoke: async () => ({}) },
      interpret: async (text, o = {}) => { seen.push(o); return null; }, collectMs: 0,
    });
    await engine.ask('telegram:42', 'hoe is het nu met de lijst van ons');
    await engine.idle();
    expect(seen[0].cacheKey).toBe('telegram:42');
  });
});

describe('the box\'s secret and its meter', () => {
  it('the secret reaches the provider (and its fallback); the counts reach the meter', async () => {
    const made = [];
    const metered = [];
    const built = await buildAssistantLlm({
      hasKey: () => 'k',
      cacheSalt: 'box-secret',
      meter: (u) => metered.push(u),
      makeProvider: async (o) => { made.push(o); return { model: o.model ?? 'glm', invoke: async () => ({ raw: { usage: { prompt_tokens: 3000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 2700 } } } }) }; },
    });
    await built.llm.invoke({ system: 's', messages: [{ role: 'user', content: 'x' }], cacheKey: 'telegram:1' });
    expect(made[0].cacheSalt).toBe('box-secret');
    expect(metered[0]).toMatchObject({ promptTokens: 3000, cachedPromptTokens: 2700, completionTokens: 20, subject: 'telegram:1' });
  });
});
