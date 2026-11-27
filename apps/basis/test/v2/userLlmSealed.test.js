/**
 * The person's own model setting is sealed at rest (ledger L1083). `basis.userLlmDefault` holds the person's own model
 * endpoint WITH its API key; it was plain JSON in localStorage (web) and AsyncStorage (phone). Now one shared io seals it
 * with the device content key, both shells use it, and an old plain value is rewritten sealed the first time it is read
 * with the key present — so a key does not sit in plain text until someone edits the setting.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal, onShellContentSeal } from '../../src/v2/localStoreSeal.js';
import { createUserLlmDefaultStore, localStorageUserLlmIo, asyncStorageUserLlmIo } from '../../src/v2/userLlmDefault.js';

const KEY = Buffer.from(new Uint8Array(32).fill(6)).toString('base64url');
const SECRET = 'sk-very-secret-key-123';
const CFG = { preset: 'openai-compatible', llmBaseUrl: 'https://llm.example/v1', llmModel: 'm', apiKey: SECRET };

function memStorage({ async = false } = {}) {
  const m = new Map();
  const wrap = (v) => (async ? Promise.resolve(v) : v);
  return { getItem: (k) => wrap(m.has(k) ? m.get(k) : null), setItem: (k, v) => wrap(void m.set(k, String(v))), removeItem: (k) => wrap(void m.delete(k)), _m: m };
}

afterEach(() => { setShellContentSeal(null); vi.restoreAllMocks(); });

describe.each([
  ['web', () => { const s = memStorage(); return { s, store: createUserLlmDefaultStore(localStorageUserLlmIo(s)) }; }],
  ['phone', () => { const s = memStorage({ async: true }); return { s, store: createUserLlmDefaultStore(asyncStorageUserLlmIo(s)) }; }],
])('the own model setting on the %s', (_n, make) => {
  it('what is stored is sealed: no API key in it, and it opens with the content key', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const { s, store } = make();
    await store.set(CFG);
    const raw = s._m.get('basis.userLlmDefault');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(SECRET);
    expect((await store.get()).apiKey).toBe(SECRET);
  });

  it('before the content key: a write is refused, a read is "nothing kept" (never the sealed text as a config), and nothing is overwritten', async () => {
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    const { s, store } = make();
    await store.set(CFG);
    const sealed = s._m.get('basis.userLlmDefault');
    setShellContentSeal(null);
    expect((await store.get()).preset).toBe('off');
    await store.set({ preset: 'local-ollama' });
    expect(s._m.get('basis.userLlmDefault')).toBe(sealed);
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    expect((await store.get()).apiKey).toBe(SECRET);
  });

  it('an old PLAIN value is read once and rewritten sealed at that read, with no edit by the person', async () => {
    const { s, store } = make();
    s._m.set('basis.userLlmDefault', JSON.stringify({ ...CFG, cacheSecret: 'x' }));
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    expect((await store.get()).apiKey).toBe(SECRET);
    expect(s._m.get('basis.userLlmDefault')).not.toContain(SECRET);
    expect((await store.get()).apiKey).toBe(SECRET);
  });

  it('the value never reaches a log', async () => {
    const spies = ['log', 'info', 'warn', 'error'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const { s, store } = make();
    s._m.set('basis.userLlmDefault', JSON.stringify(CFG));
    setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
    await store.get(); await store.set(CFG);
    setShellContentSeal(null); await store.get(); await store.set(CFG);
    for (const sp of spies) for (const call of sp.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
  });
});

describe('onShellContentSeal', () => {
  it('calls back once when the key is published, or at once if it already is; an unsubscribe before stops it', () => {
    const seen = [];
    onShellContentSeal((s) => seen.push(['early', !!s]));
    const off = onShellContentSeal(() => seen.push(['cancelled']));
    off();
    expect(seen).toEqual([]);
    const strategy = groupKeyStrategy({ groupKey: KEY });
    setShellContentSeal(strategy);
    setShellContentSeal(strategy);   // a second publish does not call again
    onShellContentSeal((s) => seen.push(['late', s === strategy]));
    expect(seen).toEqual([['early', true], ['late', true]]);
  });
});
