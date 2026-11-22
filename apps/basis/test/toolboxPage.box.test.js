/**
 * A TOOLBOX'S PAGE SERVED FROM THE BOX, on the booted box: the operator placed the page's files beside the toolbox, the
 * admin switched it on, and the box's page server listens on localhost only. A housemate admitted by invite asks
 * `/scherm boodschappen` in their own chat and gets a link with an entry (in the query) beside the pairing ticket (in
 * the fragment). Real http requests then show: no entry and no cookie is refused in words; the fresh entry is spent into
 * a cookie for that toolbox's path and the page loads; the same link does not work twice; nothing outside the page folder
 * comes back; and after `/revoke` the housemate's cookie stops working. The admin and the housemate are on Telegram (a
 * fake Bot API), the toolbox on a real socket.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';
import { fakeToolbox, TOOLBOX_KEY } from './support/fakeToolbox.js';
import { startJourneyRelay } from './support/testRelay.js';
import { until } from './support/pairRealAgents.js';
import { parseScreenStartLink } from '../src/v2/botScreens.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const ADMIN = '9';
const BEA = '22';

function raw(port, pathAndQuery, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathAndQuery, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('a toolbox\'s page served from the booted box', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('only a housemate with a fresh link gets in, once; nothing but the page folder; a revoked housemate\'s cookie stops working', async () => {
    const relay = await startJourneyRelay();
    cleanup.push(() => relay.close?.());
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const tb = await fakeToolbox();
    cleanup.push(tb.close);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-toolbox-page-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const tbDir = path.join(dataDir, 'toolboxes');
    mkdirSync(path.join(tbDir, 'boodschappen', 'page'), { recursive: true });
    // the placed page: the address the https server in front gives it, and its files on the box
    writeFileSync(path.join(tbDir, 'boodschappen.json'), JSON.stringify({ name: 'boodschappen', url: tb.base, words: [{ word: 'zoek', tool: 'products.choices', field: 'query' }], page: 'https://box.home.example:8443/boodschappen/', ops: ['lists.listEntries'] }));
    writeFileSync(path.join(tbDir, 'boodschappen.key'), TOOLBOX_KEY);
    writeFileSync(path.join(tbDir, 'boodschappen', 'page', 'index.html'), '<p>de boodschappenpagina</p>');

    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        ONDERLING_PRIMARY_DEVICE: '0', TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_TELEGRAM_API_ROOT: api.root, ONDERLING_RELAY_URL: relay.url,
        BASIS_APP_URL: 'https://basis.example/app', ONDERLING_TOOLBOX_PAGE_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });
    const ask = async (uid, text, test = () => true, name = 'Frits') => {
      const before = api.said(uid).length;
      api.write(uid, text, name);
      const got = await until(async () => api.said(uid).slice(before).find((m) => test(m)) ?? null, { timeout: 60_000, step: 250 });
      expect(got, `no answer to "${text}":\n${out.slice(-1500)}`).toBeTruthy();
      let n = -1;
      while (n !== api.said(uid).length) { n = api.said(uid).length; await new Promise((r) => { setTimeout(r, 1000); }); }
      return api.said(uid).slice(before).map((m) => m.text ?? '').join('\n');
    };
    const tap = async (uid, data) => {
      const before = api.said(uid).length;
      api.tap(uid, data, 'Frits');
      await until(async () => (api.said(uid).length > before ? true : null), { timeout: 60_000, step: 250 });
    };

    await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(out, 'no page server while no toolbox with a page is on').not.toMatch(/toolbox pages on/);
    await ask(ADMIN, '/start');
    await ask(ADMIN, '/toolbox boodschappen aan');
    await tap(ADMIN, '/toolbox boodschappen aan ja');
    const port = Number((await until(async () => /toolbox pages on 127\.0\.0\.1:(\d+)/.exec(out) ?? null, { timeout: 30_000, step: 250 }))?.[1]);
    expect(port, out.slice(-1500)).toBeGreaterThan(0);

    // an outsider on the network: the box's network addresses do not answer on the page port
    for (const host of Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address)) {
      const reached = await new Promise((resolve) => { const s = connect({ host, port }); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
      expect(reached, `the page port answered on ${host}`).toBe(false);
    }
    // …and through the door that does answer, without an entry or a cookie: refused in words
    const outsider = await raw(port, '/boodschappen/');
    expect(outsider.status).toBe(403);
    expect(outsider.body).toContain('/scherm boodschappen');
    expect(outsider.body).not.toContain('boodschappenpagina');

    // a housemate, admitted by invite
    await ask(ADMIN, '/cohort 1 1');
    const invite = await ask(ADMIN, '/invite', (m) => /\/start \S+/.test(m.text));
    await ask(BEA, `/start ${invite.match(/\/start (\S+)/)[1]}`, () => true, 'Bea');
    const said = await ask(BEA, '/scherm boodschappen', (m) => /https:\/\/box\.home\.example/.test(m.text ?? ''), 'Bea');
    const link = (/https:\/\/box\.home\.example:8443\/\S+/.exec(said) ?? [])[0];
    expect(link, said).toBeTruthy();
    const u = new URL(link);
    const entry = u.searchParams.get('e');
    expect(entry, 'the link carries an entry in its query').toBeTruthy();
    expect(parseScreenStartLink(link).ticket, 'and the pairing ticket in its fragment').toBeTruthy();

    // the fresh link: spent into a cookie for this toolbox's path, then the page
    const first = await raw(port, `${u.pathname}${u.search}`);
    expect(first.status, first.body).toBe(303);
    const setCookie = String(first.headers['set-cookie']?.[0] ?? '');
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/boodschappen/']) expect(setCookie).toContain(attr);
    const cookie = setCookie.split(';')[0];
    const page = await raw(port, first.headers.location, { cookie });
    expect(page.status).toBe(200);
    expect(page.body).toBe('<p>de boodschappenpagina</p>');
    // the same link a second time: spent
    expect((await raw(port, `${u.pathname}${u.search}`)).status).toBe(403);
    // nothing but the page folder, even with the cookie
    for (const p of ['/boodschappen/..%2fboodschappen.key', '/boodschappen/%2e%2e/boodschappen.json', '/boodschappen/../toolboxes.json']) {
      const r = await raw(port, p, { cookie });
      expect(r.status, p).not.toBe(200);
      expect(r.body, p).not.toContain(TOOLBOX_KEY);
    }
    // no entry, cookie or ticket in the box's output
    expect(out).not.toContain(entry);
    expect(out).not.toContain(cookie.split('=')[1]);

    // the housemate leaves the household: their cookie stops working
    await ask(ADMIN, '/revoke Bea');
    const after = await until(async () => ((await raw(port, '/boodschappen/', { cookie })).status === 403 ? true : null), { timeout: 15_000, step: 500 });
    expect(after, 'a revoked housemate\'s cookie is refused').toBe(true);

    // the toolbox switched off: the page server closes
    await ask(ADMIN, '/toolbox boodschappen uit');
    const closed = await until(async () => new Promise((resolve) => { const s = connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); resolve(null); }); s.once('error', () => resolve(true)); }), { timeout: 15_000, step: 500 });
    expect(closed, 'no toolbox with a page on: no listener').toBe(true);
  }, 240_000);
});
