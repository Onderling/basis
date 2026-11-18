/**
 * The toolbox client: A2A 1.0 over HTTP, as a toolbox answered it on 2026-11-18 (ledger L1035).
 *
 * @guard a tool call speaks the recorded wire (card, SendMessage, A2A-Version 1.0, bearer) and every failure ends in ONE code, never a throw
 *
 * Fixtures are the RECORDED card, request and answers (`@a2a-js/sdk` 1.3.0, A2A 1.0), trimmed to what the client reads.
 * The list answer follows the agreed shape (schema.org ItemList of Things; the brief's section 4 as ruled).
 */
import { describe, it, expect } from 'vitest';
import { readToolboxCard, callTool, readItemList, priceCents } from '../../src/v2/toolboxClient.js';

const BASE = 'http://boodschappen:3000';
const CARD = {
  name: 'Boodschappen', version: '0.1.0',
  supportedInterfaces: [{ url: `${BASE}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  skills: [{ id: 'products.choices', name: 'Products Choices', description: 'Products to choose from.' }, { id: 'meta.describe', name: 'Meta Describe', description: 'Describe.' }],
};
const answer = (data, status = 200) => ({ status, body: { jsonrpc: '2.0', id: 1, result: { message: { role: 'ROLE_AGENT', parts: [{ data, mediaType: 'application/json' }] } } } });
const UNAUTHORIZED = { status: 401, body: { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized', data: { code: 'unauthorized', params: {} } } } };

/** A fetch that replays one answer and keeps what it was asked. */
function replay(reply) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const r = typeof reply === 'function' ? reply(url, init) : reply;
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetch, seen };
}

const ITEM_LIST = {
  '@type': 'ItemList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, item: { '@type': 'Product', identifier: 'ah:33693', name: 'Halfvolle melk 1 L', description: 'AH', image: 'https://static.ah.nl/x.webp', offers: { price: '1.19', priceCurrency: 'EUR', seller: { name: 'Albert Heijn' } } } },
    { '@type': 'ListItem', position: 2, item: { '@type': 'Product', identifier: 'jumbo:753536PAK', name: 'Jumbo halfvolle melk 1 L', offers: { price: '1.05', priceCurrency: 'EUR', seller: { name: 'Jumbo' } } } },
  ],
};

describe('the card', () => {
  it('reads the endpoint and the tools from the recorded card, without the key', async () => {
    const { fetch, seen } = replay({ status: 200, body: CARD });
    const r = await readToolboxCard(BASE, { fetch });
    expect(r).toMatchObject({ ok: true, name: 'Boodschappen', endpoint: `${BASE}/a2a` });
    expect(r.tools.map((x) => x.id)).toEqual(['products.choices', 'meta.describe']);
    expect(seen[0].url).toBe(`${BASE}/.well-known/agent-card.json`);
    expect(seen[0].init.headers?.Authorization).toBeUndefined();
  });
  it('a card with no JSON-RPC 1.0 interface, or none at all, is one code', async () => {
    expect(await readToolboxCard(BASE, { fetch: replay({ status: 200, body: { ...CARD, supportedInterfaces: [] } }).fetch })).toEqual({ ok: false, code: 'toolbox-no-endpoint' });
    expect(await readToolboxCard(BASE, { fetch: replay({ status: 404, body: {} }).fetch })).toEqual({ ok: false, code: 'toolbox-unreachable' });
  });
});

describe('a call', () => {
  it('speaks the recorded wire: POST, JSON-RPC SendMessage, A2A-Version 1.0, the bearer key, one data part', async () => {
    const { fetch, seen } = replay(answer({ operation: 'products.choices', output: ITEM_LIST }));
    const r = await callTool({ endpoint: `${BASE}/a2a`, key: 'sleutel', tool: 'products.choices', input: { query: 'halfvolle melk' }, fetch });
    expect(r).toEqual({ ok: true, output: ITEM_LIST });
    const { init, body } = seen[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'A2A-Version': '1.0', Authorization: 'Bearer sleutel' });
    expect(body).toMatchObject({ jsonrpc: '2.0', method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ data: { operation: 'products.choices', input: { query: 'halfvolle melk' } } }] } } });
    expect(typeof body.params.message.messageId).toBe('string');
  });
  it('a tool\'s own error (HTTP 200) is its code, passed on', async () => {
    const r = await callTool({ endpoint: `${BASE}/a2a`, key: 'k', tool: 'products.search', input: { query: '' },
      fetch: replay(answer({ operation: 'products.search', error: { code: 'invalid_input', params: { issues: ['query: Too small'] } } })).fetch });
    expect(r).toEqual({ ok: false, code: 'tool-error', toolCode: 'invalid_input' });
  });
  it('the endpoint\'s own errors, a timeout and a broken answer each end in one code', async () => {
    const at = { endpoint: `${BASE}/a2a`, key: 'k', tool: 'products.choices', input: {} };
    expect(await callTool({ ...at, fetch: replay(UNAUTHORIZED).fetch })).toEqual({ ok: false, code: 'toolbox-unauthorized' });
    expect(await callTool({ ...at, fetch: replay({ status: 500, body: {} }).fetch })).toEqual({ ok: false, code: 'toolbox-error' });
    expect(await callTool({ ...at, fetch: replay(new Error('ECONNREFUSED')).fetch })).toEqual({ ok: false, code: 'toolbox-unreachable' });
    expect(await callTool({ ...at, fetch: replay({ status: 200, body: { jsonrpc: '2.0', result: {} } }).fetch })).toEqual({ ok: false, code: 'toolbox-bad-answer' });
    const never = () => new Promise(() => {});
    expect(await callTool({ ...at, timeoutMs: 20, fetch: never })).toEqual({ ok: false, code: 'toolbox-timeout' });
  });
});

describe('a list of things', () => {
  it('reads label, detail, picture, price and the reference as given; the source rides beside it', () => {
    const r = readItemList(ITEM_LIST, { source: 'boodschappen' });
    expect(r.ok).toBe(true);
    expect(r.items[0]).toEqual({ label: 'Halfvolle melk 1 L', detail: 'AH', image: 'https://static.ah.nl/x.webp', price: '1.19', seller: 'Albert Heijn', ref: { type: 'Product', ref: 'ah:33693', source: 'boodschappen' } });
    expect(r.items[1].ref).toEqual({ type: 'Product', ref: 'jumbo:753536PAK', source: 'boodschappen' });
  });
  it('anything else is one refusal code, never a guess', () => {
    for (const bad of [null, {}, { '@type': 'ItemList' }, { '@type': 'ItemList', itemListElement: [{ item: { name: 'x' } }] }]) {
      expect(readItemList(bad)).toEqual({ ok: false, code: 'not-an-item-list' });
    }
  });
  it('a price is a decimal string in, whole cents out, with no float arithmetic', () => {
    expect(priceCents('1.19')).toBe(119);
    expect(priceCents('0.1')).toBe(10);
    expect(priceCents('12')).toBe(1200);
    expect(priceCents('2,49')).toBe(249);
    expect(priceCents('veel')).toBeNull();
    expect(priceCents('1.234')).toBeNull();
  });
});
