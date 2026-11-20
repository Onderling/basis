/**
 * A toolbox's page served from the box: on localhost only, only the files of its page folder, and only to a browser
 * that came in with a fresh entry from the bot's link (spent into a cookie for that toolbox's path) or holds that
 * cookie, for a person who is still in the household. Real http requests against the real listener.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { createPageEntries, createToolboxPages, TOOLBOX_PAGE_ENTRY_MS, TOOLBOX_PAGE_COOKIE_MS } from '../../src/v2/toolboxPages.js';
import { SCREEN_PAIRING_TTL_MS } from '../../src/v2/screenDoor.js';
import { initLocalisation, t } from '../../src/localisation.js';

const memoryStore = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'basis-toolbox-pages-'));
  const tb = path.join(dir, 'toolboxes');
  for (const name of ['boodschappen', 'recepten']) {
    mkdirSync(path.join(tb, name, 'page', 'sub'), { recursive: true });
    writeFileSync(path.join(tb, name, 'page', 'index.html'), `<p>${name} page</p>`);
    writeFileSync(path.join(tb, name, 'page', 'app.js'), 'export const x = 1;');
    writeFileSync(path.join(tb, name, 'page', 'run.sh'), 'echo no');
    writeFileSync(path.join(tb, name, 'page', '.hidden.txt'), 'hidden');
    writeFileSync(path.join(tb, name, 'page', 'sub', 'index.html'), 'sub page');
    writeFileSync(path.join(tb, `${name}.key`), 'THE-TOOLBOX-KEY');
  }
  writeFileSync(path.join(dir, 'vault.json'), 'THE-VAULT');
  // a link inside the page folder that leads OUT of it, to the toolbox's key
  symlinkSync(path.join(tb, 'boodschappen.key'), path.join(tb, 'boodschappen', 'page', 'leak.txt'));
  const clock = { now: 1_000_000 };
  const on = new Set(['boodschappen', 'recepten']);
  const members = new Set(['telegram:1', 'telegram:2']);
  const logs = [];
  const store = memoryStore();
  const entries = createPageEntries({ store, now: () => clock.now });
  const pages = createToolboxPages({
    entries, pagesDir: tb,
    onToolboxes: async () => [...on],
    pageOf: async (name) => (on.has(name) ? { page: `https://box.example/${name}/` } : null),
    mayEnter: async (person) => members.has(person),
    t, port: 0, log: (e) => logs.push(e),
  });
  return { dir, tb, clock, on, members, logs, store, entries, pages };
}

/** A raw request: the path exactly as written (no client normalises `..` away). */
function raw(port, pathAndQuery, { method = 'GET', headers = {}, host = '127.0.0.1', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, method, path: pathAndQuery, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const cookieOf = (res) => String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];

describe('a toolbox\'s page served from the box', () => {
  let ctx;
  beforeAll(async () => { await initLocalisation({ lng: 'nl' }); });
  afterEach(async () => { await ctx?.pages.close(); if (ctx) rmSync(ctx.dir, { recursive: true, force: true }); ctx = null; });

  it('listens on localhost only, and only while a toolbox with a page is on', async () => {
    ctx = setup();
    ctx.on.clear();
    await ctx.pages.sync();
    expect(ctx.pages.address(), 'no page on: no listener').toBe(null);
    ctx.on.add('boodschappen');
    await ctx.pages.sync();
    const a = ctx.pages.address();
    expect(a.host).toBe('127.0.0.1');
    // an outsider on the network: the box's network addresses do not answer on the page port at all
    const outward = Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address);
    for (const host of outward) {
      const reached = await new Promise((resolve) => {
        const s = connect({ host, port: a.port });
        s.once('connect', () => { s.destroy(); resolve(true); });
        s.once('error', () => resolve(false));
      });
      expect(reached, `the page port answered on ${host}`).toBe(false);
    }
    ctx.on.clear();
    await ctx.pages.sync();
    expect(ctx.pages.address(), 'switched off: closed').toBe(null);
  });

  it('an outsider without an entry or cookie gets the refusal page, in words, for every path', async () => {
    ctx = setup();
    await ctx.pages.sync();
    const { port } = ctx.pages.address();
    for (const p of ['/boodschappen/', '/boodschappen/app.js', '/boodschappen/?e=made-up']) {
      const r = await raw(port, p);
      expect(r.status, p).toBe(403);
      expect(r.body).toContain('/scherm boodschappen');
      expect(r.body).not.toContain('boodschappen page');
    }
    const en = await raw(port, '/boodschappen/', { headers: { 'accept-language': 'en-GB,en;q=0.9' } });
    expect(en.body).toContain(t('circle.bot.toolbox_page_refused_title', {}, 'en'));
    expect(en.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a household member with a fresh link gets in: the entry is spent into a cookie for that toolbox\'s path; the link does not work twice', async () => {
    ctx = setup();
    const entry = await ctx.pages.entryFor('telegram:1', 'boodschappen');
    expect(entry).toBeTruthy();
    const { port } = ctx.pages.address();
    const first = await raw(port, `/boodschappen/?e=${entry}`);
    expect(first.status).toBe(303);
    expect(first.headers.location, 'the same address without the entry').toBe('/boodschappen/');
    const set = String(first.headers['set-cookie']?.[0] ?? '');
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/boodschappen/', `Max-Age=${TOOLBOX_PAGE_COOKIE_MS / 1000}`]) expect(set).toContain(attr);
    const cookie = cookieOf(first);
    const page = await raw(port, '/boodschappen/', { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.body).toBe('<p>boodschappen page</p>');
    expect((await raw(port, '/boodschappen/app.js', { headers: { cookie } })).headers['content-type']).toBe('text/javascript; charset=utf-8');
    // the same link again, in another browser: spent
    expect((await raw(port, `/boodschappen/?e=${entry}`)).status).toBe(403);
    // the cookie is this toolbox's only
    expect((await raw(port, '/recepten/', { headers: { cookie } })).status).toBe(403);
    // nothing secret in a log line
    const said = JSON.stringify(ctx.logs);
    expect(said).not.toContain(entry);
    expect(said).not.toContain(cookie.split('=')[1]);
    expect(ctx.logs).toContainEqual({ what: 'entered', toolbox: 'boodschappen' });
    // and the store keeps no secret either: only its hash
    expect([...ctx.store.m.values()].join('')).not.toContain(entry.split('.')[1]);
  });

  it('an entry is for one toolbox, one use and short-lived: one of another toolbox, or one too old, does not open the page', async () => {
    ctx = setup();
    expect(TOOLBOX_PAGE_ENTRY_MS, 'the entry lives as long as the ticket it is made beside').toBe(SCREEN_PAIRING_TTL_MS);
    const other = await ctx.pages.entryFor('telegram:1', 'recepten');
    const { port } = ctx.pages.address();
    expect((await raw(port, `/boodschappen/?e=${other}`)).status).toBe(403);
    expect((await raw(port, `/recepten/?e=${other}`)).status, 'spent by the wrong door: gone').toBe(403);
    const old = await ctx.pages.entryFor('telegram:1', 'boodschappen');
    ctx.clock.now += TOOLBOX_PAGE_ENTRY_MS + 1;
    expect((await raw(port, `/boodschappen/?e=${old}`)).status).toBe(403);
    expect(ctx.logs.map((l) => l.reason).filter(Boolean)).toEqual(expect.arrayContaining(['entry-other-toolbox', 'entry-unknown', 'entry-expired']));
  });

  it('a removed member\'s cookie stops working: asked on every request, and their rows are dropped', async () => {
    ctx = setup();
    const { port } = (await ctx.pages.sync(), ctx.pages.address());
    const enter = async (person) => cookieOf(await raw(port, `/boodschappen/?e=${await ctx.pages.entryFor(person, 'boodschappen')}`));
    const cookie = await enter('telegram:2');
    expect((await raw(port, '/boodschappen/', { headers: { cookie } })).status).toBe(200);
    ctx.members.delete('telegram:2');
    expect((await raw(port, '/boodschappen/', { headers: { cookie } })).status, 'no longer in the household').toBe(403);
    // an entry handed out before they left does not let them in either
    ctx.members.add('telegram:2');
    const pending = await ctx.pages.entryFor('telegram:2', 'boodschappen');
    ctx.members.delete('telegram:2');
    expect((await raw(port, `/boodschappen/?e=${pending}`)).status).toBe(403);
    // and leaving removes the rows: back in later, the old cookie is still dead
    ctx.members.add('telegram:2');
    await ctx.pages.dropPerson('telegram:2');
    expect((await raw(port, '/boodschappen/', { headers: { cookie } })).status).toBe(403);
    // a cookie of an expired life: dead
    const c2 = await enter('telegram:1');
    ctx.clock.now += TOOLBOX_PAGE_COOKIE_MS + 1;
    expect((await raw(port, '/boodschappen/', { headers: { cookie: c2 } })).status).toBe(403);
  });

  it('nothing but the page folder is served: no way out by .., an encoded slash, a dot file, a link out, a listing or another type', async () => {
    ctx = setup();
    const entry = await ctx.pages.entryFor('telegram:1', 'boodschappen');
    const { port } = ctx.pages.address();
    const cookie = cookieOf(await raw(port, `/boodschappen/?e=${entry}`));
    const tries = [
      '/boodschappen/../boodschappen.key', '/boodschappen/%2e%2e/boodschappen.key', '/boodschappen/..%2fboodschappen.key',
      '/boodschappen/%2e%2e%2f%2e%2e%2fvault.json', '/boodschappen/sub/..%2f..%2f..%2fvault.json', '/boodschappen/..%5c..%5cvault.json',
      '/boodschappen/leak.txt', '/boodschappen/.hidden.txt', '/boodschappen/run.sh', '/boodschappen/sub', '/boodschappen/%00index.html',
      '/toolboxes.json', '/boodschappen.key', '/../vault.json', '/boodschappen/page/index.html',
    ];
    for (const p of tries) {
      const r = await raw(port, p, { headers: { cookie } });
      expect(r.status, p).not.toBe(200);
      expect(r.body, p).not.toContain('THE-TOOLBOX-KEY');
      expect(r.body, p).not.toContain('THE-VAULT');
      expect(r.body, p).not.toContain('hidden');
      expect(r.body, p).not.toContain('echo');
    }
    expect(ctx.logs).toContainEqual({ what: 'refused', toolbox: 'boodschappen', reason: 'outside-page' });
    // a folder with an index is that index, never a listing
    expect((await raw(port, '/boodschappen/sub/', { headers: { cookie } })).body).toBe('sub page');
    // the bare toolbox path goes to its slash (the cookie's path), keeping the entry
    const bare = await raw(port, '/boodschappen?e=abc');
    expect(bare.status).toBe(308);
    expect(bare.headers.location).toBe('/boodschappen/?e=abc');
  });

  it('a page is only read: another method is refused and no body is read', async () => {
    ctx = setup();
    const entry = await ctx.pages.entryFor('telegram:1', 'boodschappen');
    const { port } = ctx.pages.address();
    const r = await raw(port, `/boodschappen/?e=${entry}`, { method: 'POST', body: 'x'.repeat(1000) });
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe('GET, HEAD');
    // the POST did not spend the entry
    expect((await raw(port, `/boodschappen/?e=${entry}`)).status).toBe(303);
  });

  it('a toolbox switched off: its page is refused, its rows are dropped, and no entry is made for it', async () => {
    ctx = setup();
    const entry = await ctx.pages.entryFor('telegram:1', 'boodschappen');
    const { port } = ctx.pages.address();
    const cookie = cookieOf(await raw(port, `/boodschappen/?e=${entry}`));
    ctx.on.delete('boodschappen');
    await ctx.pages.sync();
    expect((await raw(port, '/boodschappen/', { headers: { cookie } })).status).toBe(403);
    expect(await ctx.pages.entryFor('telegram:1', 'boodschappen')).toBe(null);
    ctx.on.add('boodschappen');
    await ctx.pages.sync();
    expect((await raw(port, '/boodschappen/', { headers: { cookie } })).status, 'on again: the old cookie stays dead').toBe(403);
    // a toolbox on without a page folder: no entry
    rmSync(path.join(ctx.tb, 'recepten', 'page'), { recursive: true });
    expect(await ctx.pages.entryFor('telegram:1', 'recepten')).toBe(null);
  });
});
