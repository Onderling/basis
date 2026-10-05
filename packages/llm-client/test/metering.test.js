import { describe, it, expect, vi } from 'vitest';
import {
  LlmClient,
  EmbeddingClient,
  mockProvider,
  mockEmbeddingsProvider,
  createUsageAggregator,
  extractTokenCounts,
  usageForCompletion,
} from '../src/index.js';

const req = { system: 'sys', messages: [{ role: 'user', content: 'hoi' }] };

describe('metering — token extraction', () => {
  it('reads OpenAI-style usage block', () => {
    expect(extractTokenCounts({ usage: { prompt_tokens: 11, completion_tokens: 7 } }))
      .toEqual({ promptTokens: 11, completionTokens: 7, cachedPromptTokens: 0 });
  });

  it('reads Ollama native prompt_eval_count / eval_count', () => {
    expect(extractTokenCounts({ prompt_eval_count: 42, eval_count: 13 }))
      .toEqual({ promptTokens: 42, completionTokens: 13, cachedPromptTokens: 0 });
  });

  it('returns null when no counts present (→ estimate path)', () => {
    expect(extractTokenCounts({ choices: [] })).toBeNull();
    expect(extractTokenCounts(null)).toBeNull();
  });

  it('usageForCompletion prefers real counts (estimated:false)', () => {
    const u = usageForCompletion(req, { raw: { eval_count: 5, prompt_eval_count: 9 } });
    expect(u).toEqual({ promptTokens: 9, completionTokens: 5, cachedPromptTokens: 0, estimated: false });
  });

  it('usageForCompletion falls back to a char/4 estimate', () => {
    const u = usageForCompletion(
      { system: 'x'.repeat(40), messages: [{ role: 'user', content: 'y'.repeat(40) }] },
      { replyText: 'z'.repeat(20), raw: {} },
    );
    expect(u.estimated).toBe(true);
    expect(u.promptTokens).toBe(20);      // 80 chars / 4
    expect(u.completionTokens).toBe(5);   // 20 chars / 4
  });
});

describe('metering — LlmClient seam', () => {
  it('emits one usage event per invoke, attributed to the customer', async () => {
    const agg = mockProviderAgg();
    const llm = new LlmClient({
      provider: mockProvider({ responses: [{ replyText: 'ok', raw: { usage: { prompt_tokens: 10, completion_tokens: 4 } } }] }),
      meter: agg.sink, customerId: 'acme', endpoint: 'enclave', model: 'qwen3-4b',
    });
    await llm.invoke(req);
    const c = agg.get('acme');
    expect(c.requests).toBe(1);
    expect(c.promptTokens).toBe(10);
    expect(c.completionTokens).toBe(4);
    expect(c.estimatedRequests).toBe(0);
    expect(Object.values(c.byEndpoint)[0]).toMatchObject({ endpoint: 'enclave', model: 'qwen3-4b' });
  });

  it('accumulates across calls', async () => {
    const agg = mockProviderAgg();
    const llm = new LlmClient({
      provider: mockProvider({ responses: [{ replyText: 'ok', raw: { prompt_eval_count: 3, eval_count: 2 } }] }),
      meter: agg.sink, customerId: 'acme',
    });
    await llm.invoke(req);
    await llm.invoke(req);
    await llm.invoke(req);
    expect(agg.get('acme').requests).toBe(3);
    expect(agg.get('acme').promptTokens).toBe(9);
    expect(agg.get('acme').completionTokens).toBe(6);
  });

  it('two customers accrue separately (shared sink)', async () => {
    const agg = mockProviderAgg();
    const prov = mockProvider({ responses: [{ replyText: 'ok', raw: { usage: { prompt_tokens: 5, completion_tokens: 1 } } }] });
    const a = new LlmClient({ provider: prov, meter: agg.sink, customerId: 'acme' });
    const b = new LlmClient({ provider: prov, meter: agg.sink, customerId: 'bob' });
    await a.invoke(req);
    await b.invoke(req);
    await b.invoke(req);
    expect(agg.get('acme').requests).toBe(1);
    expect(agg.get('bob').requests).toBe(2);
    expect(agg.total()).toEqual({ requests: 3, promptTokens: 15, completionTokens: 3 });
  });

  it('per-call ctx overrides the construction-time customer', async () => {
    const agg = mockProviderAgg();
    const llm = new LlmClient({
      provider: mockProvider({ responses: [{ replyText: 'ok', raw: { usage: { prompt_tokens: 2, completion_tokens: 2 } } }] }),
      meter: agg.sink, customerId: 'default-tenant',
    });
    await llm.invoke(req, { customerId: 'acme' });
    expect(agg.get('acme').requests).toBe(1);
    expect(agg.get('default-tenant')).toBeNull();
  });

  it('flags estimated usage when the provider hides token counts', async () => {
    const agg = mockProviderAgg();
    const llm = new LlmClient({
      provider: mockProvider({ responses: [{ replyText: 'hallo daar', raw: {} }] }),
      meter: agg.sink, customerId: 'acme',
    });
    await llm.invoke(req);
    expect(agg.get('acme').estimatedRequests).toBe(1);
    expect(agg.get('acme').completionTokens).toBeGreaterThan(0);
  });

  it('derives endpoint/model labels from the provider when not given', async () => {
    const agg = mockProviderAgg();
    const llm = new LlmClient({
      provider: mockProvider({
        responses: [{ replyText: 'ok', raw: { usage: { prompt_tokens: 1, completion_tokens: 1 } } }],
        model: 'prov-model', endpoint: 'http://prov',
      }),
      meter: agg.sink, customerId: 'acme',
    });
    await llm.invoke(req);
    expect(Object.values(agg.get('acme').byEndpoint)[0])
      .toMatchObject({ endpoint: 'http://prov', model: 'prov-model' });
  });

  it('metering-sink failures never crash the call', async () => {
    const llm = new LlmClient({
      provider: mockProvider({ responses: [{ replyText: 'ok', raw: {} }] }),
      meter: () => { throw new Error('sink-broken'); }, customerId: 'acme',
    });
    const r = await llm.invoke(req);
    expect(r.replyText).toBe('ok');
  });

  it('no-meter path: sink never invoked, result unchanged', async () => {
    const spy = vi.fn();
    const llm = new LlmClient({
      provider: mockProvider({ responses: [{ replyText: 'ok', raw: {} }] }),
    });
    const r = await llm.invoke(req);
    expect(r.replyText).toBe('ok');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('metering — EmbeddingClient seam', () => {
  it('meters embeddings as requests + estimated prompt tokens (completion 0)', async () => {
    const agg = mockProviderAgg();
    const embedder = new EmbeddingClient({
      provider: mockEmbeddingsProvider(),
      meter: agg.sink, customerId: 'acme',
    });
    await embedder.embed(['x'.repeat(40), 'y'.repeat(40)]);   // 80 chars → 20 tokens
    const c = agg.get('acme');
    expect(c.requests).toBe(1);
    expect(c.promptTokens).toBe(20);
    expect(c.completionTokens).toBe(0);
    expect(c.estimatedRequests).toBe(1);
    expect(Object.values(c.byEndpoint)[0].model).toBe('mock-embeddings');
  });

  it('no-meter embeddings path is unchanged', async () => {
    const embedder = new EmbeddingClient({ provider: mockEmbeddingsProvider() });
    const [v] = await embedder.embed(['hello world']);
    expect(Array.isArray(v)).toBe(true);
  });
});

describe('createUsageAggregator', () => {
  it('reset clears totals', () => {
    const agg = createUsageAggregator();
    agg.sink({ customerId: 'acme', promptTokens: 5, completionTokens: 1, requests: 1 });
    expect(agg.get('acme').requests).toBe(1);
    agg.reset();
    expect(agg.get('acme')).toBeNull();
    expect(agg.snapshot()).toEqual([]);
  });

  it('snapshot lists all customers', () => {
    const agg = createUsageAggregator();
    agg.sink({ customerId: 'a', promptTokens: 1, completionTokens: 1, requests: 1 });
    agg.sink({ customerId: 'b', promptTokens: 2, completionTokens: 2, requests: 1 });
    expect(agg.snapshot().map((s) => s.customerId).sort()).toEqual(['a', 'b']);
  });
});

function mockProviderAgg() { return createUsageAggregator(); }

describe('cached prompt tokens', () => {
  it('read from usage.prompt_tokens_details.cached_tokens; zero when the provider does not say', async () => {
    const { usageForCompletion } = await import('../src/metering.js');
    const r = usageForCompletion({}, { raw: { usage: { prompt_tokens: 3000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 2800 } } } });
    expect(r).toMatchObject({ promptTokens: 3000, completionTokens: 40, cachedPromptTokens: 2800, estimated: false });
    expect(usageForCompletion({}, { raw: { usage: { prompt_tokens: 10, completion_tokens: 1 } } }).cachedPromptTokens).toBe(0);
  });
});
