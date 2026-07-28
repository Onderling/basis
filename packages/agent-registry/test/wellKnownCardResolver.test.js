/**
 * commons-governance G2 — the A2A well-known card resolver seam.
 *
 * The trust-graph walk resolves an endorsed agent's Agent Card via an injected
 * `resolveCard`. In real deployment that card is fetched from the agent's A2A
 * `.well-known/agent` path. This asserts the fetch-backed resolver over an
 * INJECTED fetch (hermetic — no real network), which is why it stays a seam.
 */
import { describe, it, expect } from 'vitest';
import { createWellKnownCardResolver } from '../index.js';

function okJson(card) { return { ok: true, json: async () => card }; }

describe('G2 — createWellKnownCardResolver (injected fetch)', () => {
  it('fetches <url>/.well-known/agent from the endorsement url hint', async () => {
    const card = { name: 'A', 'x-onderling': { id: 'catalog:a', pubKey: 'pk-a' } };
    const calls = [];
    const fetchImpl = async (u) => { calls.push(u); return okJson(card); };
    const resolve = createWellKnownCardResolver({ fetch: fetchImpl });

    const got = await resolve('pk-a', { url: 'https://host.invalid/agents/a/' });
    expect(got).toBe(card);
    expect(calls[0]).toBe('https://host.invalid/agents/a/.well-known/agent');
  });

  it('falls back to baseFor(subject) when the endorsement carries no url', async () => {
    const card = { 'x-onderling': { pubKey: 'pk-b' } };
    const resolve = createWellKnownCardResolver({
      fetch: async () => okJson(card),
      baseFor: (subject) => `https://reg.invalid/${subject}`,
    });
    expect(await resolve('pk-b', {})).toBe(card);
  });

  it('returns null when every well-known path misses; requires an injected fetch', async () => {
    const resolve = createWellKnownCardResolver({ fetch: async () => ({ ok: false }) });
    expect(await resolve('pk-c', { url: 'https://x.invalid' })).toBeNull();
    expect(await resolve('pk-c', {})).toBeNull();   // no url, no baseFor → null
    expect(() => createWellKnownCardResolver({})).toThrow(/fetch/);
  });
});
