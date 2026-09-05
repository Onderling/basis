/**
 * discoverA2A carries an agent card's `x-onderling.redact` onto the peer record — the ask a client
 * honours by redacting on its own device before a turn is sent (basis's pre-send floor).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { discoverA2A } from '../src/a2a/a2aDiscover.js';
import { AgentCardBuilder } from '../src/a2a/AgentCardBuilder.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fakeFetch(card) {
  return vi.fn(async () => ({ ok: true, json: async () => card }));
}

describe('discoverA2A — the redact ask', () => {
  it('reads x-onderling.redact onto the peer record (string or ruleset object)', async () => {
    const upserts = [];
    const peerGraph = { upsert: async (r) => { upserts.push(r); } };
    globalThis.fetch = fakeFetch({ name: 'Bot', 'x-onderling': { redact: 'pre-send' } });
    const rec = await discoverA2A({}, 'https://bot.example', { peerGraph });
    expect(rec.redact).toBe('pre-send');
    expect(upserts[0].redact).toBe('pre-send');
    const rules = { mode: 'pre-send', rules: [{ type: 'code', pattern: 'X-\\d+' }], placeholders: { code: '[code]' } };
    globalThis.fetch = fakeFetch({ name: 'Bot', 'x-onderling': { redact: rules } });
    expect((await discoverA2A({}, 'https://bot.example')).redact).toEqual(rules);
  });
  it('is null when the card asks nothing', async () => {
    globalThis.fetch = fakeFetch({ name: 'Bot' });
    expect((await discoverA2A({}, 'https://bot.example')).redact).toBeNull();
  });
  it('AgentCardBuilder writes the ask into x-onderling when configured', () => {
    const agent = { pubKey: 'PK', label: 'Bot', skills: { all: () => [] } };
    const withAsk = new AgentCardBuilder({ agent, config: { redact: 'pre-send' } }).build();
    expect(withAsk['x-onderling'].redact).toBe('pre-send');
    expect(new AgentCardBuilder({ agent, config: {} }).build()['x-onderling'].redact).toBeUndefined();
  });
});
