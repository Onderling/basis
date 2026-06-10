import { describe, it, expect } from 'vitest';
import {
  createUserLlmDefaultStore, normalizeUserLlmDefault, localStorageUserLlmIo, DEFAULT_USER_LLM,
} from '../../src/v2/userLlmDefault.js';

describe('normalizeUserLlmDefault', () => {
  it('keeps valid modes', () => {
    expect(normalizeUserLlmDefault({ mode: 'local' })).toEqual({ mode: 'local' });
    expect(normalizeUserLlmDefault({ mode: 'cloud' })).toEqual({ mode: 'cloud' });
    expect(normalizeUserLlmDefault({ mode: 'off' })).toEqual({ mode: 'off' });
  });
  it('coerces unknown/malformed to off', () => {
    expect(normalizeUserLlmDefault(null)).toEqual({ mode: 'off' });
    expect(normalizeUserLlmDefault({})).toEqual({ mode: 'off' });
    expect(normalizeUserLlmDefault({ mode: 'gpt' })).toEqual({ mode: 'off' });
    expect(DEFAULT_USER_LLM).toEqual({ mode: 'off' });
  });
});

describe('createUserLlmDefaultStore', () => {
  it('returns off when nothing is stored', async () => {
    const store = createUserLlmDefaultStore({ load: () => null });
    expect(await store.get()).toEqual({ mode: 'off' });
  });

  it('round-trips set → get through an injected IO', async () => {
    let saved = null;
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    expect(await store.set('cloud')).toEqual({ mode: 'cloud' });
    expect(saved).toEqual({ mode: 'cloud' });
    expect(await store.get()).toEqual({ mode: 'cloud' });
  });

  it('set normalises an invalid mode to off', async () => {
    let saved = null;
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    expect(await store.set('hal9000')).toEqual({ mode: 'off' });
  });

  it('survives a throwing load adapter', async () => {
    const store = createUserLlmDefaultStore({ load: () => { throw new Error('boom'); } });
    expect(await store.get()).toEqual({ mode: 'off' });
  });

  it('localStorageUserLlmIo persists under a stable key', async () => {
    const mem = new Map();
    const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
    const store = createUserLlmDefaultStore(localStorageUserLlmIo(storage));
    await store.set('local');
    // a fresh store over the same storage reads it back
    const store2 = createUserLlmDefaultStore(localStorageUserLlmIo(storage));
    expect(await store2.get()).toEqual({ mode: 'local' });
  });
});
