/**
 * A tool call crosses a REAL socket (ledger L1035): the client's fetch against an HTTP server that answers as the
 * recorded toolbox did (the card, SendMessage, the bearer key checked, a 401 without it).
 *
 * @guard the toolbox wire is crossed for real: a socket, an HTTP server, the client's own fetch
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readToolboxCard, callTool, readItemList } from '../../src/v2/toolboxClient.js';

const KEY = 'sleutel-voor-de-test';
let server; let base; const seen = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const json = (status, v) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.method === 'GET' && req.url === '/.well-known/agent-card.json') {
        return json(200, { name: 'Boodschappen', supportedInterfaces: [{ url: `${base}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], skills: [{ id: 'products.choices', name: 'Products Choices' }] });
      }
      if (req.method === 'POST' && req.url === '/a2a') {
        if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized', data: { code: 'unauthorized', params: {} } } });
        const msg = JSON.parse(body);
        const data = msg.params.message.parts[0].data;
        return json(200, { jsonrpc: '2.0', id: msg.id, result: { message: { role: 'ROLE_AGENT', parts: [{ data: { operation: data.operation, output: {
          '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, item: { '@type': 'Product', identifier: 'ah:33693', name: `${data.input.query} 1 L`, offers: { price: '1.19' } } }],
        } } }] } } });
      }
      return json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe('a tool call over a real socket', () => {
  it('reads the card, calls the tool with the key, and reads the list that comes back', async () => {
    const card = await readToolboxCard(base);
    expect(card).toMatchObject({ ok: true, name: 'Boodschappen', endpoint: `${base}/a2a` });
    const r = await callTool({ endpoint: card.endpoint, key: KEY, tool: 'products.choices', input: { query: 'Halfvolle melk' } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(readItemList(r.output, { source: 'boodschappen' }).items[0]).toMatchObject({ label: 'Halfvolle melk 1 L', ref: { type: 'Product', ref: 'ah:33693', source: 'boodschappen' } });
    const post = seen.find((s) => s.method === 'POST');
    expect(post.headers['a2a-version']).toBe('1.0');
    expect(post.body).not.toContain(KEY);
  });
  it('without the right key the endpoint refuses, and the client says so in one code', async () => {
    expect(await callTool({ endpoint: `${base}/a2a`, key: 'fout', tool: 'products.choices', input: { query: 'x' } })).toEqual({ ok: false, code: 'toolbox-unauthorized' });
  });
});
