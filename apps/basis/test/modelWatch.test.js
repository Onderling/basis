/**
 * The box watches its model route, so a model the provider stopped serving, or an account over its limit, reaches the
 * admin instead of a household that only hears "the assistant is not answering" (2026-10-03: Privatemode removed
 * kimi-k2.6, and later the account hit its monthly token limit; neither was said to anyone).
 */
import { describe, it, expect } from 'vitest';
import { createModelWatch, isOverLimit } from '../src/v2/modelWatch.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
function watch({ served = ['glm-5.3', 'glm-5.3-flash'] } = {}) {
  let now = 0;
  const told = [];
  const logged = [];
  const w = createModelWatch({
    listModels: async () => served, model: 'glm-5.3', fallback: 'glm-5.3-flash', t,
    tellAdmin: async (text) => { told.push(text); }, log: (e) => logged.push(e), now: () => now,
  });
  return { w, told, logged, advance: (ms) => { now += ms; } };
}

describe('the box watches its model route', () => {
  it('both served: nothing said', async () => {
    const d = watch();
    await d.w.check();
    expect(d.told).toEqual([]);
  });

  it('the model is not served: the admin is told which, and what is used instead; once', async () => {
    const d = watch({ served: ['glm-5.3-flash', 'gpt-oss-120b'] });
    await d.w.check();
    await d.w.check();
    expect(d.told).toHaveLength(1);
    expect(d.told[0]).toContain('circle.bot.model_not_served');
    expect(d.told[0]).toContain('glm-5.3');
    expect(d.logged.at(-1)).toMatchObject({ kind: 'model-watch', missing: ['glm-5.3'] });
  });

  it('the account over its limit: said to the admin once a day, not at every turn', async () => {
    const d = watch();
    const err = Object.assign(new Error("ollama: 401 401 invalid API key: you have exceeded your organization's monthly limit of 1000000 prompt tokens"), { status: 401 });
    expect(isOverLimit(err)).toBe(true);
    expect(isOverLimit(Object.assign(new Error('401 unauthorized'), { status: 401 }))).toBe(false);
    await d.w.providerError(err);
    await d.w.providerError(err);
    expect(d.told).toEqual(['circle.bot.model_over_limit']);
    d.advance(25 * 3600 * 1000);
    await d.w.providerError(err);
    expect(d.told).toHaveLength(2);
  });

  it('the list cannot be read: logged, nothing said (a network blip is not news)', async () => {
    let now = 0;
    const told = []; const logged = [];
    const w = createModelWatch({ listModels: async () => { throw new Error('ECONNRESET'); }, model: 'glm-5.3', fallback: 'glm-5.3-flash', t, tellAdmin: async (x) => told.push(x), log: (e) => logged.push(e), now: () => now });
    await w.check();
    expect(told).toEqual([]);
    expect(logged.at(-1)).toMatchObject({ kind: 'model-watch', error: 'ECONNRESET' });
  });
});

// 2026-10-29: the tablet's proxy refused every completion with 401 while the boot watch said "served 13 missing []" —
// a models list needs no key, a completion does. The watch now makes one authenticated one-token completion each tick.
describe('the box checks its model key with a real completion', () => {
  const KEY = 'pm-SECRET-KEY-VALUE';
  function keyed({ probe, alert = true } = {}) {
    let now = 0;
    const told = []; const alerted = []; const logged = [];
    const w = createModelWatch({
      listModels: async () => ['glm-5.3', 'glm-5.3-flash'], model: 'glm-5.3', fallback: 'glm-5.3-flash', t,
      probe, secretName: 'PRIVATEMODE_API_KEY',
      tellAdmin: async (text) => { told.push(text); },
      ...(alert ? { alertBox: async (text) => { alerted.push(text); } } : {}),
      log: (e) => logged.push(e), now: () => now,
    });
    return { w, told, alerted, logged, advance: (ms) => { now += ms; } };
  }
  const refuses = async () => { throw Object.assign(new Error(`ollama: 401 Unauthorized for key ${KEY}`), { status: 401 }); };

  it('models listed but the completion refused: the alert chat hears the status, never the key; once per hour', async () => {
    const d = keyed({ probe: refuses });
    await d.w.check();
    await d.w.check();
    expect(d.alerted).toHaveLength(1);
    expect(d.alerted[0]).toContain('circle.bot.secret_check_failed');
    expect(d.alerted[0]).toContain('401');
    expect(d.alerted[0]).toContain('PRIVATEMODE_API_KEY');
    expect(JSON.stringify([d.alerted, d.logged])).not.toContain(KEY);
    d.advance(60 * 60 * 1000);
    await d.w.check();
    expect(d.alerted, 'an hour later it is said again').toHaveLength(2);
  });

  it('the walk log keeps one secret-check record per tick: the secret NAME and the status', async () => {
    const d = keyed({ probe: refuses });
    await d.w.check();
    expect(d.logged.find((e) => e.kind === 'secret-check')).toEqual({ kind: 'secret-check', secret: 'PRIVATEMODE_API_KEY', ok: false, status: 401 });
    const ok = keyed({ probe: async () => ({ text: '.' }) });
    await ok.w.check();
    expect(ok.logged.find((e) => e.kind === 'secret-check')).toEqual({ kind: 'secret-check', secret: 'PRIVATEMODE_API_KEY', ok: true, status: 200 });
    expect(ok.alerted).toEqual([]);
  });

  it('no alert chat on this box: the admin hears it instead', async () => {
    const d = keyed({ probe: refuses, alert: false });
    await d.w.check();
    expect(d.told.some((x) => x.includes('circle.bot.secret_check_failed'))).toBe(true);
  });

  it('the watch now ticks hourly, so an hourly alert can happen at all', async () => {
    const { MODEL_WATCH_EVERY_MS } = await import('../src/v2/modelWatch.js');
    expect(MODEL_WATCH_EVERY_MS).toBe(60 * 60 * 1000);
  });
});

// Across the seam: the real Privatemode provider, built the way the box builds it, over a client whose models list
// answers while every completion is refused — the tablet's state on 2026-10-29.
describe('a proxy that lists models but refuses completions', () => {
  it('the built route\'s probe is refused with the status, and the watch says so where the old watch saw "missing []"', async () => {
    const { buildAssistantLlm } = await import('../src/telegram/assistantLlm.js');
    const { privatemodeProvider } = await import('@onderling/llm-client/providers/privatemode');
    const client = {
      models: { list: async () => ({ data: [{ id: 'glm-5.3' }, { id: 'glm-5.3-flash' }] }) },
      chat: { completions: { create: async () => { throw Object.assign(new Error('Set secrets: Unauthorized (401)'), { status: 401 }); } } },
    };
    const built = await buildAssistantLlm({ hasKey: () => true, model: 'glm-5.3', fallbackModel: 'glm-5.3-flash', makeProvider: (o) => privatemodeProvider({ ...o, client }), warn: (m) => { throw new Error(m); } });
    expect(await built.listModels(), 'the list needs no key: it answers').toEqual(['glm-5.3', 'glm-5.3-flash']);
    const alerted = []; const logged = [];
    const w = createModelWatch({ listModels: built.listModels, probe: built.probe, model: 'glm-5.3', fallback: 'glm-5.3-flash', t, tellAdmin: async () => {}, alertBox: async (x) => { alerted.push(x); }, log: (e) => logged.push(e) });
    await w.check();
    expect(logged).toContainEqual({ kind: 'model-watch', served: 2, missing: [] });
    expect(logged).toContainEqual({ kind: 'secret-check', secret: 'PRIVATEMODE_API_KEY', ok: false, status: 401 });
    expect(alerted).toHaveLength(1);
  });
});
