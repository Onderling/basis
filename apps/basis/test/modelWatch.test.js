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
