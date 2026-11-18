/**
 * The person's own route sends a prompt-cache salt per person (Fable's ruling, 2026-11-17, after measuring that
 * Privatemode caches WITHOUT a salt, per key): an HMAC of a secret this device keeps with the setting and the
 * conversation, as the box does. Two people behind one key (a household proxy on the tablet) then never share a cache.
 * A plain OpenAI-compatible cloud gets none (an unknown field there can be refused).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildCircleLlmProviders } from '../../src/v2/circleLlmProviders.js';
import { buildUserLlmRuntime } from '../../src/v2/userLlmRuntime.js';
import { createUserLlmDefaultStore } from '../../src/v2/userLlmDefault.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const capture = () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  return bodies;
};
const ask = (client, cacheKey) => client.invoke({ system: 's', messages: [{ role: 'user', content: 'hoi' }], tools: [], cacheKey });

describe('the own route\'s prompt-cache salt', () => {
  it('one salt per conversation, from the device\'s secret; base64url (Privatemode refuses a "/")', async () => {
    const bodies = capture();
    const { local } = buildCircleLlmProviders({ localBaseUrl: 'http://127.0.0.1:11434', model: 'glm-5.3', cacheSecret: 'a-device-secret-of-enough-length-000' });
    await ask(local, 'own:me'); await ask(local, 'own:me'); await ask(local, 'own:werk');
    const [a, b, c] = bodies.map((x) => x.cache_salt);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(bodies[0].reasoning_effort, 'the reasoning switch still rides along').toBe('low');
  });
  it('the setting keeps a secret once a route is set, and the same one after; the plain cloud preset sends no salt', async () => {
    let saved = null;
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    const first = await store.set({ preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434' });
    expect(first.cacheSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await store.set({ llmModel: 'glm-5.3' })).cacheSecret).toBe(first.cacheSecret);
    expect((await store.get()).cacheSecret).toBe(first.cacheSecret);
    const bodies = capture();
    const local = buildUserLlmRuntime({ ...first, llmModel: 'glm-5.3' }, { env: {} }).llmProviders.local;
    await ask(local, 'own:me');
    expect(bodies.at(-1).cache_salt).toBeTruthy();
    const cloudCfg = await store.set({ preset: 'openai-compatible', llmBaseUrl: 'https://api.example.test', apiKey: 'k' });
    const cloud = buildUserLlmRuntime(cloudCfg, { env: {} }).llmProviders.cloud;
    await ask(cloud, 'own:me');
    expect(bodies.at(-1)).not.toHaveProperty('cache_salt');
  });
  it('a route saved before the secret existed gets one on its first read, and keeps it', async () => {
    let saved = { preset: 'local-ollama', mode: 'local', llmBaseUrl: 'http://127.0.0.1:11434' };
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    const first = await store.get();
    expect(first.cacheSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved.cacheSecret).toBe(first.cacheSecret);
    expect((await store.get()).cacheSecret).toBe(first.cacheSecret);
  });
});
