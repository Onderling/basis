/**
 * The person's own route sends the model family's low-reasoning switch, whatever the endpoint (a local server, a
 * Privatemode proxy, any OpenAI-compatible cloud): with nothing sent, GLM reasons at max, the most expensive way to call
 * it (Fable measured it through the laptop stand-in, 2026-11-17). An unknown family gets nothing extra.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildCircleLlmProviders } from '../../src/v2/circleLlmProviders.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function bodyFor(model) {
  let body = null;
  globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const { local } = buildCircleLlmProviders({ localBaseUrl: 'http://127.0.0.1:11434', model });
  await local.invoke({ system: 's', messages: [{ role: 'user', content: 'hoi' }], tools: [] });
  return body;
}

describe('the own route asks the model for low reasoning, by its family', () => {
  it('GLM gets reasoning_effort low; an unknown family nothing extra', async () => {
    expect((await bodyFor('glm-5.3')).reasoning_effort).toBe('low');
    expect(await bodyFor('qwen2.5:7b-instruct')).not.toHaveProperty('reasoning_effort');
  });
});
