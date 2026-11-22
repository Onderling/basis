/**
 * A toolbox on a real socket, as the recorded boodschappen toolbox answers (ledger L1035): its card, products.choices as
 * a schema.org ItemList with two shops, and its things' pictures served from its own host. For booted-box tests.
 */
import { createServer } from 'node:http';

/** The key the operator places beside the toolbox's record. */
export const TOOLBOX_KEY = 'sleutel-voor-de-proef';
const KEY = TOOLBOX_KEY;

/**
 * A toolbox as the recorded one answers: the card, and products.choices as a schema.org ItemList. `perShop`: how many
 * things per shop, shop by shop (Albert Heijn's first, then Jumbo's); the first of each is the recorded one. `inputs`
 * holds every tool input it was asked with.
 */
export async function fakeToolbox({ perShop = 1 } = {}) {
  let base = '';
  const inputs = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (status, v) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      // the toolbox serves its things' pictures itself (the box fetches them from this host only)
      if (req.method === 'GET' && req.url.startsWith('/img/')) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])); return; }
      if (req.method === 'GET' && req.url === '/.well-known/agent-card.json') {
        return json(200, { name: 'Boodschappen', supportedInterfaces: [{ url: `${base}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], skills: [{ id: 'products.choices', name: 'Products Choices' }] });
      }
      if (req.method === 'POST' && req.url === '/a2a') {
        if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
        const msg = JSON.parse(body);
        const data = msg.params.message.parts[0].data;
        inputs.push(data.input);
        const product = (id, name, price, seller) => ({ '@type': 'ListItem', item: { '@type': 'Product', identifier: id, name, image: `${base}/img/${id}.jpg`, offers: { price, seller: { name: seller } } } });
        const more = (shop, prefix) => Array.from({ length: Math.max(0, perShop - 1) }, (_, i) => product(`${prefix}:${i + 2}`, `${shop} melk ${i + 2}`, '1.00', shop));
        return json(200, { jsonrpc: '2.0', id: msg.id, result: { message: { role: 'ROLE_AGENT', parts: [{ data: { operation: data.operation, output: {
          '@type': 'ItemList', itemListElement: [product('ah:33693', 'Halfvolle melk 1 L', '1.19', 'Albert Heijn'), ...more('Albert Heijn', 'ah'), product('jumbo:753536PAK', 'Jumbo halfvolle melk 1 L', '1.05', 'Jumbo'), ...more('Jumbo', 'jumbo')],
        } } }] } } });
      }
      return json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, inputs, close: () => new Promise((r) => server.close(r)) };
}

