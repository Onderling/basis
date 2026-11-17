import { describe, it, expect } from 'vitest';
import {
  createUserLlmDefaultStore, normalizeUserLlmDefault, localStorageUserLlmIo, DEFAULT_USER_LLM,
} from '../../src/v2/userLlmDefault.js';

// Since 6e253460 the value carries the member's full endpoint config — `{ mode, preset, …endpoints }` — and
// `mode` follows the preset (local→local-ollama, cloud→openai-compatible, off→off). `full()` is the empty-
// endpoint default for a given mode/preset; the endpoint-carrying case is covered separately below.
const full = (mode, preset) => ({
  mode, preset, llmBaseUrl: '', llmModel: '', embedBaseUrl: '', embedModel: '', apiKey: '', attestation: false,
});

describe('normalizeUserLlmDefault', () => {
  it('keeps valid modes, mapping each to its preset', () => {
    expect(normalizeUserLlmDefault({ mode: 'local' })).toEqual(full('local', 'local-ollama'));
    expect(normalizeUserLlmDefault({ mode: 'cloud' })).toEqual(full('cloud', 'openai-compatible'));
    expect(normalizeUserLlmDefault({ mode: 'off' })).toEqual(full('off', 'off'));
  });
  it('coerces unknown/malformed to off', () => {
    expect(normalizeUserLlmDefault(null)).toEqual(full('off', 'off'));
    expect(normalizeUserLlmDefault({})).toEqual(full('off', 'off'));
    expect(normalizeUserLlmDefault({ mode: 'gpt' })).toEqual(full('off', 'off'));
    expect(DEFAULT_USER_LLM).toEqual(full('off', 'off'));
  });
  it('carries the member’s endpoint config (the 6e253460 capability)', () => {
    const out = normalizeUserLlmDefault({
      preset: 'openai-compatible', llmBaseUrl: 'https://api.example/v1', llmModel: 'gpt-x',
      embedBaseUrl: 'https://emb.example', embedModel: 'e5', apiKey: 'sk-1', attestation: true,
    });
    expect(out).toEqual({
      mode: 'cloud', preset: 'openai-compatible', llmBaseUrl: 'https://api.example/v1', llmModel: 'gpt-x',
      embedBaseUrl: 'https://emb.example', embedModel: 'e5', apiKey: 'sk-1', attestation: true,
    });
  });
});

describe('createUserLlmDefaultStore', () => {
  it('returns off when nothing is stored', async () => {
    const store = createUserLlmDefaultStore({ load: () => null });
    expect(await store.get()).toEqual(full('off', 'off'));
  });

  it('round-trips set → get through an injected IO', async () => {
    let saved = null;
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    // a route that is set gets its prompt-cache secret once, kept with it
    const withSecret = { ...full('cloud', 'openai-compatible'), cacheSecret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) };
    expect(await store.set('cloud')).toEqual(withSecret);
    expect(saved).toEqual(withSecret);
    expect(await store.get()).toEqual({ ...withSecret, cacheSecret: saved.cacheSecret });
  });

  it('set normalises an invalid mode to off', async () => {
    let saved = null;
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    expect(await store.set('hal9000')).toEqual(full('off', 'off'));
  });

  it('survives a throwing load adapter', async () => {
    const store = createUserLlmDefaultStore({ load: () => { throw new Error('boom'); } });
    expect(await store.get()).toEqual(full('off', 'off'));
  });

  it('localStorageUserLlmIo persists under a stable key', async () => {
    const mem = new Map();
    const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
    const store = createUserLlmDefaultStore(localStorageUserLlmIo(storage));
    await store.set('local');
    // a fresh store over the same storage reads it back
    const store2 = createUserLlmDefaultStore(localStorageUserLlmIo(storage));
    expect(await store2.get()).toEqual({ ...full('local', 'local-ollama'), cacheSecret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  });
});
