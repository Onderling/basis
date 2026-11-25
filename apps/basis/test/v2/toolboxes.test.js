/**
 * A circle's toolboxes: PLACED by the operator, switched ON by the admin's yes, used by a member, the key never seen
 * (ledger L1035; Fable's rulings 2026-11-18).
 *
 * @guard a toolbox's key never appears in a reply, a refusal, a log line or the list of tools, and a toolbox with no key on the box is refused before any call leaves
 * @guard a placed toolbox is off until the admin's yes; one that is off is refused before any call leaves, and its words reach nothing
 *
 * The operator places a toolbox as one file (name, address, words) beside its key; no chat line carries an address, a
 * tool id or a key. `addToolbox {name}` shows the card first and switches the toolbox on only when confirmed.
 */
import { describe, it, expect } from 'vitest';
import { makeToolboxOps, toolboxGateRule, toolboxRefusalText } from '../../src/v2/toolboxes.js';

const KEY = 'geheime-sleutel-123';
const CARD = { name: 'Boodschappen', supportedInterfaces: [{ url: 'http://boodschappen:3000/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  skills: [{ id: 'products.choices', name: 'Products Choices', description: 'Products to choose from.' }] };
const LIST = { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, item: { '@type': 'Product', identifier: 'ah:33693', name: 'Halfvolle melk 1 L', offers: { price: '1.19' } } }] };
const PLACED = { name: 'boodschappen', url: 'http://boodschappen:3000', words: [{ word: 'zoek', tool: 'products.choices', field: 'query' }] };

function harness({ keys = { boodschappen: KEY }, placed = [PLACED], answer = { operation: 'products.choices', output: LIST }, images = {} } = {}) {
  const vault = new Map();
  const store = { get: async (k) => vault.get(k) ?? null, set: async (k, v) => { vault.set(k, v); } };
  const calls = []; const logs = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/.well-known/agent-card.json')) return { ok: true, status: 200, json: async () => CARD };
    if (images[url]) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(images[url]).buffer };
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { message: { parts: [{ data: answer }] } } }) };
  };
  const ops = makeToolboxOps({ store, placedOf: async () => placed, keyOf: async (name) => keys[name] ?? null, fetch, log: (...a) => logs.push(JSON.stringify(a)) });
  return { ops, calls, logs, vault, keys, placed, fetch };
}
const all = (...xs) => JSON.stringify(xs);
const on = async (h) => { await h.ops.load(); return h.ops.addToolbox({ name: 'boodschappen', confirm: true }); };

describe('a placed toolbox, switched on by the admin', () => {
  it('a placed toolbox is OFF: listed as off, its tool refused before anything leaves, its word reaches nothing', async () => {
    const h = harness(); await h.ops.load();
    expect(await h.ops.listTools({ all: true })).toMatchObject({ ok: true, toolboxes: [{ name: 'boodschappen', on: false, words: PLACED.words }] });
    expect((await h.ops.listTools({})).toolboxes, 'a member sees only what is on').toEqual([]);
    const before = h.calls.length;
    expect(await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } })).toEqual({ ok: false, code: 'toolbox-off', name: 'boodschappen' });
    expect(h.calls.length).toBe(before);
    expect(toolboxGateRule(() => h.ops.wordsNow()).test('zoek melk')).toBe(false);
  });

  it('switching on shows the card first (name, address, words, what it receives); only the yes switches it on', async () => {
    const h = harness(); await h.ops.load();
    const ask = await h.ops.addToolbox({ name: 'boodschappen' });
    expect(ask).toMatchObject({ ok: true, pending: true, name: 'boodschappen', title: 'Boodschappen', url: 'http://boodschappen:3000', words: PLACED.words, receives: ['question'] });
    expect((await h.ops.listTools({ all: true })).toolboxes[0].on).toBe(false);
    const yes = await h.ops.addToolbox({ name: 'boodschappen', confirm: true });
    expect(yes).toMatchObject({ ok: true, on: true, name: 'boodschappen', title: 'Boodschappen' });
    expect((await h.ops.listTools({})).toolboxes).toMatchObject([{ name: 'boodschappen', title: 'Boodschappen', on: true }]);
    expect(all(ask, yes, [...h.vault.values()], h.logs)).not.toContain(KEY);
  });

  it('a name the operator did not place, or one whose key is not on the box, is refused in a plain code', async () => {
    const h = harness({ keys: {} }); await h.ops.load();
    expect(await h.ops.addToolbox({ name: 'elders' })).toEqual({ ok: false, code: 'toolbox-not-placed', name: 'elders' });
    expect(await h.ops.addToolbox({ name: 'boodschappen', confirm: true })).toEqual({ ok: false, code: 'toolbox-no-key', name: 'boodschappen' });
    expect((await h.ops.listTools({})).toolboxes).toEqual([]);
  });

  it('a member uses a tool of an ON toolbox: the key goes in the header only; a list of things comes back as choices', async () => {
    const h = harness(); await on(h);
    const r = await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'halfvolle melk' } });
    expect(r).toMatchObject({ ok: true, items: [{ label: 'Halfvolle melk 1 L', price: '1.19', ref: { type: 'Product', ref: 'ah:33693', source: 'boodschappen' } }] });
    const sent = h.calls.at(-1);
    expect(sent.init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(sent.init.body).not.toContain(KEY);
    expect(all(r, h.logs, await h.ops.listTools({ all: true }))).not.toContain(KEY);
  });

  it('a picture on the toolbox\'s own host comes back as bytes on the row; a shop\'s own URL is never fetched', async () => {
    const item = (id, image) => ({ '@type': 'ListItem', item: { '@type': 'Product', identifier: id, name: id, image, offers: { price: '1.00' } } });
    const answer = { operation: 'products.choices', output: { '@type': 'ItemList', itemListElement: [item('a', 'http://boodschappen:3000/img/a.jpg'), item('b', 'https://shop.example/b.jpg')] } };
    const h = harness({ answer, images: { 'http://boodschappen:3000/img/a.jpg': [0xff, 0xd8, 0xff, 0xe0, 1, 2] } }); await on(h);
    const r = await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'x' } });
    expect(r.items[0].thumb?.mime).toBe('image/jpeg');
    expect(r.items[1].thumb).toBeUndefined();
    expect(r.items.map((x) => x.image)).toEqual([null, null]);
    expect(h.calls.some((c) => String(c.url).startsWith('https://shop.example'))).toBe(false);
  });

  it('for a door that shows no pictures (the in-app thread) the box fetches none: no bytes ride the relay (Fable on the pictures PR)', async () => {
    const item = (id, image) => ({ '@type': 'ListItem', item: { '@type': 'Product', identifier: id, name: id, image, offers: { price: '1.00' } } });
    const answer = { operation: 'products.choices', output: { '@type': 'ItemList', itemListElement: [item('a', 'http://boodschappen:3000/img/a.jpg')] } };
    const h = harness({ answer, images: { 'http://boodschappen:3000/img/a.jpg': [0xff, 0xd8, 0xff, 0xe0, 1, 2] } }); await on(h);
    const r = await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'x' } }, { pictures: false });
    expect(r.items[0].thumb).toBeUndefined();
    expect(h.calls.some((c) => String(c.url).endsWith('/img/a.jpg'))).toBe(false);
  });

  it('a toolbox whose key is gone is refused BEFORE any call leaves; a tool it does not offer likewise', async () => {
    const h = harness(); await on(h);
    const before = h.calls.length;
    expect(await h.ops.useTool({ toolbox: 'boodschappen', tool: 'lists.create', input: {} })).toEqual({ ok: false, code: 'tool-not-offered', name: 'boodschappen', tool: 'lists.create' });
    delete h.keys.boodschappen;
    expect(await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } })).toEqual({ ok: false, code: 'toolbox-no-key', name: 'boodschappen' });
    expect(h.calls.length, 'nothing left the box').toBe(before);
  });

  it('a tool\'s own error comes back as its code; the key is in none of it', async () => {
    const h = harness({ answer: { operation: 'products.choices', error: { code: 'invalid_input', params: {} } } }); await on(h);
    const r = await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: {} });
    expect(r).toMatchObject({ ok: false, code: 'tool-error', toolCode: 'invalid_input', toolError: { code: 'invalid_input' }, name: 'boodschappen' });
    expect(all(r, h.logs)).not.toContain(KEY);
  });

  it('a placed file whose words name a tool the card does not offer is refused at the yes; switching off keeps the file', async () => {
    const h = harness({ placed: [{ ...PLACED, words: [{ word: 'zoek', tool: 'products.nope', field: 'query' }] }] }); await h.ops.load();
    expect(await h.ops.addToolbox({ name: 'boodschappen', confirm: true })).toEqual({ ok: false, code: 'tool-not-offered', name: 'boodschappen', tool: 'products.nope' });
    const g = harness(); await on(g);
    expect(await g.ops.removeToolbox({ name: 'boodschappen' })).toEqual({ ok: true, on: false, name: 'boodschappen' });
    expect((await g.ops.listTools({ all: true })).toolboxes[0]).toMatchObject({ name: 'boodschappen', on: false });
  });
});

describe('a toolbox\'s words reach its tool through the deterministic gate', () => {
  it('"zoek halfvolle melk" and "/zoek halfvolle melk" become useTool with the rest of the line in the named field', async () => {
    const h = harness(); await on(h);
    const rule = toolboxGateRule(() => h.ops.wordsNow());
    for (const line of ['zoek halfvolle melk', '/zoek halfvolle melk', 'Zoek  halfvolle melk ']) {
      expect(rule.test(line), line).toBe(true);
      expect(rule.command(line)).toEqual({ opId: 'useTool', appOrigin: 'tools', args: { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'halfvolle melk' } } });
    }
    expect(rule.test('zoek')).toBe(false);
    expect(rule.test('zoekt iemand de sleutel')).toBe(false);
    expect(h.ops.wordsNow()).toEqual([{ word: 'zoek', tool: 'products.choices', field: 'query', toolbox: 'boodschappen', title: 'Boodschappen' }]);
    await h.ops.removeToolbox({ name: 'boodschappen' });
    expect(rule.test('zoek melk'), 'a switched-off toolbox\'s word reaches nothing').toBe(false);
  });
});

describe('the door\'s words for a toolbox', () => {
  it('a refusal is a sentence by code (never the key); help and welcome lines come from the words that are on', async () => {
    const { toolboxRefusalText, toolboxHelpLines, toolboxWelcomeLine } = await import('../../src/v2/toolboxes.js');
    const t = (k, p) => `${k} ${JSON.stringify(p ?? {})}`;
    expect(toolboxRefusalText({ ok: false, code: 'toolbox-no-key', name: 'boodschappen' }, t)).toBe('circle.bot.toolbox_no_key {"name":"boodschappen","title":"boodschappen","tool":"","word":""}');
    expect(toolboxRefusalText({ ok: true }, t)).toBeNull();
    const words = [{ word: 'zoek', toolbox: 'boodschappen', title: 'Boodschappen', says: { nl: 'zoekt producten bij Boodschappen' } }];
    expect(toolboxHelpLines(words, t, 'nl')).toEqual(['circle.bot.toolbox_help_line {"word":"zoek","says":"zoekt producten bij Boodschappen"}']);
    expect(toolboxHelpLines([{ word: 'zoek', title: 'Boodschappen' }], t, 'en')[0]).toContain('toolbox_says_default');
    expect(toolboxWelcomeLine([], t)).toBeNull();
    expect(toolboxWelcomeLine(words, t)).toContain('circle.bot.toolbox_welcome');
  });
});

describe('what the admin said yes to is what runs (Fable on #1405)', () => {
  it('a card whose endpoint is on another host than the placed address is refused; the key never goes there', async () => {
    const h = harness();
    const keyless = []; const origFetch = h.ops;
    const evil = makeToolboxOps({
      store: { get: async () => null, set: async () => {} }, placedOf: async () => [PLACED], keyOf: async () => KEY,
      fetch: async (url, init = {}) => { keyless.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ...CARD, supportedInterfaces: [{ url: 'https://elders.example/a2a', protocolBinding: 'JSONRPC' }] }) }; },
    });
    await evil.load();
    expect(await evil.addToolbox({ name: 'boodschappen', confirm: true })).toEqual({ ok: false, code: 'toolbox-no-endpoint', name: 'boodschappen' });
    expect(keyless.every((c) => !JSON.stringify(c).includes(KEY))).toBe(true);
    void origFetch;
  });

  it('both fetches refuse a redirect', async () => {
    const h = harness(); await on(h);
    await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } });
    expect(h.calls.length).toBeGreaterThan(1);
    for (const c of h.calls) expect(c.init.redirect, c.url).toBe('error');
  });

  it('the yes covers the record it was shown: a changed address or new words switch it off until a new yes', async () => {
    const h = harness(); await on(h);
    expect(h.ops.wordsNow().length).toBe(1);
    h.placed[0] = { ...PLACED, words: [...PLACED.words, { word: 'prijs', tool: 'products.choices', field: 'keys' }] };
    await h.ops.load();
    expect(h.ops.wordsNow(), 'new words do not start working unasked').toEqual([]);
    expect(await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } })).toEqual({ ok: false, code: 'toolbox-off', name: 'boodschappen' });
    expect((await h.ops.listTools({ all: true })).toolboxes[0]).toMatchObject({ on: false, changed: true });
    await h.ops.addToolbox({ name: 'boodschappen', confirm: true });
    expect(h.ops.wordsNow().map((w) => w.word)).toEqual(['zoek', 'prijs']);
  });

  it('a word this door already uses is refused at the switch, and named', async () => {
    const vault = new Map();
    const ops = makeToolboxOps({
      store: { get: async (k) => vault.get(k) ?? null, set: async (k, v) => { vault.set(k, v); } },
      placedOf: async () => [PLACED], keyOf: async () => KEY, takenWords: () => new Set(['zoek', 'help']),
      fetch: async () => ({ ok: true, status: 200, json: async () => CARD }),
    });
    await ops.load();
    expect(await ops.addToolbox({ name: 'boodschappen' })).toEqual({ ok: false, code: 'toolbox-word-taken', name: 'boodschappen', word: 'zoek' });
    expect(await ops.addToolbox({ name: 'boodschappen', confirm: true })).toEqual({ ok: false, code: 'toolbox-word-taken', name: 'boodschappen', word: 'zoek' });
  });
});

describe('a toolbox page\'s placed address: https, or loopback on the same device', () => {
  const pageOf = async (page) => { const h = harness({ placed: [{ ...PLACED, page }] }); await on(h); return h.ops.pageOf('boodschappen'); };

  it('keeps an https page and a loopback page (localhost and 127.0.0.1, with a port and a path)', async () => {
    for (const page of ['https://box.home.example:8443/boodschappen/', 'http://localhost:5173/boodschappen/', 'http://127.0.0.1:8080/b/index.html?x=1']) {
      expect(await pageOf(page), page).toEqual({ page, ops: [] });
    }
  });

  it('drops a plain http page on any other host, a look-alike host, a userinfo trick, and [::1] (not admitted)', async () => {
    for (const page of ['http://box.home.example/boodschappen/', 'http://192.168.1.5:8080/', 'http://localhost.evil.example/',
      'http://127.0.0.1.evil.example/', 'http://localhost@evil.example/', 'http://evil.example@localhost:8080/', 'http://[::1]:8080/',
      'ftp://localhost/', 'localhost:8080/', 'http://localhost:8080/ spatie']) {
      expect(await pageOf(page), page).toBeNull();
    }
  });
});

/**
 * A PAGE ON PLAIN HTTP IN THE HOME NETWORK, AS THE OPERATOR'S CHOICE (ledger L1183, Frits 2026-11-22). Only with an
 * explicit `"pageOverHttp": "home-network"` in the placed file, and only on a private address (10/8, 172.16/12,
 * 192.168/16, a `.local` name); the yes covers that choice, and the card says the risk before it. Every other http
 * address stays refused, with the choice or without it.
 */
describe('a toolbox page on plain http in the home network, as the operator\'s explicit choice', () => {
  const HOME = { pageOverHttp: 'home-network' };
  const pageOf = async (page, extra = {}) => { const h = harness({ placed: [{ ...PLACED, page, ...extra }] }); await on(h); return h.ops.pageOf('boodschappen'); };

  it('with the choice: a private address or a .local name is kept', async () => {
    for (const page of ['http://192.168.1.5:8080/', 'http://10.0.0.7/b/', 'http://172.16.4.2:8710/', 'http://172.31.255.1/', 'http://tablet.local:8710/']) {
      expect(await pageOf(page, HOME), page).toEqual({ page, ops: [] });
    }
  });

  it('without the choice the same addresses stay refused', async () => {
    for (const page of ['http://192.168.1.5:8080/', 'http://tablet.local:8710/']) expect(await pageOf(page), page).toBeNull();
  });

  it('with the choice, a public address, a look-alike, a userinfo trick, another value of the choice stay refused', async () => {
    for (const page of ['http://box.home.example/', 'http://172.32.0.1/', 'http://11.0.0.1/', 'http://192.168.1.5.evil.example/',
      'http://local/', 'http://evil.example@192.168.1.5/', 'http://192.168.1.5@evil.example/', 'http://8.8.8.8/']) {
      expect(await pageOf(page, HOME), page).toBeNull();
    }
    expect(await pageOf('http://192.168.1.5/', { pageOverHttp: 'yes' })).toBeNull();
  });

  it('the card says the choice (so the bot can say the risk), and the yes covers it: dropping the choice ends the yes', async () => {
    const h = harness({ placed: [{ ...PLACED, page: 'http://192.168.1.5:8710/', ...HOME }] });
    const card = await h.ops.addToolbox({ name: 'boodschappen' });
    expect(card).toMatchObject({ ok: true, pending: true, page: 'http://192.168.1.5:8710/', pageOverHttp: 'home-network' });
    const https = harness({ placed: [{ ...PLACED, page: 'https://box.example/' }] });
    expect((await https.ops.addToolbox({ name: 'boodschappen' })).pageOverHttp).toBeUndefined();
  });
});

/**
 * A TOOLBOX'S PAGE IS NEVER ON THE WEB APP'S OWN ORIGIN (ledger L1041 b): a page served from the app's origin shares
 * everything the app keeps in the browser (its storage, its key door), so switching on a toolbox whose placed page has
 * the app's origin is refused, in words, and nothing is switched on. Another path on the same host and port is the same
 * origin; another port is not.
 */
describe('a toolbox page on the web app\'s own origin', () => {
  const APP = 'https://onderling.org/basis/';
  const withApp = (page) => {
    const h = harness({ placed: [{ ...PLACED, page }] });
    const ops = makeToolboxOps({ store: { get: async () => null, set: async () => {} }, placedOf: async () => [{ ...PLACED, page }], keyOf: async () => KEY, fetch: h.fetch, appUrl: APP });
    return ops;
  };
  it('the same origin (any path) is refused at the switch, with a code the door says', async () => {
    for (const page of ['https://onderling.org/boodschappen/', 'https://onderling.org/basis/pagina', 'https://ONDERLING.org:443/x']) {
      const ops = withApp(page); await ops.load();
      expect(await ops.addToolbox({ name: 'boodschappen' }), page).toMatchObject({ ok: false, code: 'toolbox-page-is-app-origin' });
      expect(toolboxRefusalText({ ok: false, code: 'toolbox-page-is-app-origin', name: 'boodschappen' }, (k) => k)).toBe('circle.bot.toolbox_page_app_origin');
    }
  });
  it('another origin (host or port) is not refused for that', async () => {
    for (const page of ['https://boodschappen.onderling.org/', 'https://onderling.org:8443/x', 'http://127.0.0.1:8710/']) {
      const ops = withApp(page); await ops.load();
      expect((await ops.addToolbox({ name: 'boodschappen' })).code, page).not.toBe('toolbox-page-is-app-origin');
    }
  });
});

describe('the toolbox switches are never written over when they could not be read', () => {
  const opsOver = (get, vault) => makeToolboxOps({
    store: { get, set: async (k, v) => { vault.set(k, v); } },
    placedOf: async () => [PLACED], keyOf: async () => KEY,
    fetch: async () => ({ ok: true, status: 200, json: async () => CARD }),
  });
  it('a vault entry that will not decrypt: a switch is refused in words, nothing is written', async () => {
    const vault = new Map();
    const ops = opsOver(async () => { throw new Error('decrypt failed'); }, vault);
    await ops.load();
    const r = await ops.addToolbox({ name: 'boodschappen', confirm: true });
    expect(r).toEqual({ ok: false, code: 'toolbox-switches-unreadable', name: 'boodschappen' });
    expect(vault.size, 'the switches were written over').toBe(0);
    expect(toolboxRefusalText(r, (k) => k)).toContain('toolbox_switches_unreadable');
  });
  it('a value that does not parse: kept, the switch refused', async () => {
    const vault = new Map([['tools.on', '{"boodschappen": {"tit']]);
    const ops = opsOver(async (k) => vault.get(k) ?? null, vault);
    await ops.load();
    const r = await ops.addToolbox({ name: 'boodschappen', confirm: true });
    expect(r.code).toBe('toolbox-switches-unreadable');
    expect(vault.get('tools.on')).toBe('{"boodschappen": {"tit');
  });
});
