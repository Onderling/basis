/**
 * A PERSON'S AGENDA AS A LINK, walked on real processes: the household's box (the runner, against a Bot API of our own)
 * and the household's companion (its own boot, as the box role runs it), over one relay. Paired the way an admin pairs
 * them: the companion first (its address), the box told that address, the companion restarted with the box as its
 * owner. Then: the switch is off → no link; on → `/agenda-link` sends a link privately; fetching it gives the agenda with
 * the appointment; a new appointment re-renders it; asking again turns the old link dark; `/revoke` turns a person's
 * link dark; and before any of it, the route answers 404.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';
import { startJourneyRelay } from './support/testRelay.js';
import { until } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const COMPANION = fileURLToPath(new URL('../../companion-node/src/boot.js', import.meta.url));
const ADMIN = '9';
const BEA = '22';

const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

describe('the agenda link, on a real box and a real companion', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  /** A process, its output kept; `until(text)` waits for a line. */
  function proc(file, args, env) {
    let out = '';
    const child = spawn(process.execPath, [file, ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    const stop = () => new Promise((r) => { if (child.exitCode != null) return r(); child.once('exit', r); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 8000); });
    cleanup.push(() => child.kill('SIGKILL'));
    return { stop, log: () => out, waitFor: (re, ms = 90_000) => until(async () => (re.exec(out) ?? null), { timeout: ms, step: 200 }) };
  }
  async function ask(api, uid, text, test = () => true, { name = 'Frits', log = () => '' } = {}) {
    const before = api.said(uid).length;
    api.write(uid, text, name);
    const got = await until(async () => api.said(uid).slice(before).find((m) => test(m)) ?? null, { timeout: 60_000, step: 250 });
    expect(got, `no answer to "${text}" (said: ${JSON.stringify(api.said(uid).slice(before).map((m) => m.text))})\n${log().slice(-1500)}`).toBeTruthy();
    let n = -1;
    while (n !== api.said(uid).length) { n = api.said(uid).length; await new Promise((r) => { setTimeout(r, 800); }); }
    return { ...got, all: api.said(uid).slice(before).map((m) => m.text).join('\n') };
  }
  const fetchFeed = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }; };

  it('off, then on: the link carries the agenda, follows a change, and goes dark when renewed or revoked', async () => {
    const relay = await startJourneyRelay();
    cleanup.push(() => relay.close?.());
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const boxDir = mkdtempSync(path.join(tmpdir(), 'agenda-box-'));
    const compDir = mkdtempSync(path.join(tmpdir(), 'agenda-companion-'));
    cleanup.push(() => rmSync(boxDir, { recursive: true, force: true }), () => rmSync(compDir, { recursive: true, force: true }));
    const httpPort = await freePort();
    const base = `http://127.0.0.1:${httpPort}`;
    const compEnv = (owner) => ({
      COMPANION_RELAY_URL: relay.url, COMPANION_NODE_CONFIG_DIR: compDir, COMPANION_MANAGE_OWNER_PUBKEY: owner,
      COMPANION_MANAGE_HTTP_PORT: String(httpPort), COMPANION_MANAGE_HTTP_HOST: '127.0.0.1', COMPANION_FEEDS: 'on',
    });

    // 0 · the companion exists (its address); nobody owns it yet that could put anything
    let comp = proc(COMPANION, [], compEnv('nobody-yet'));
    const companionAddress = (await comp.waitFor(/Host agent:\s+(\S+)/))[1];
    expect((await fetchFeed(`${base}/feed/${'a'.repeat(32)}.${'b'.repeat(43)}.ics`)).status, 'the route before any put').toBe(404);
    await comp.stop();

    // 1 · the box, told the companion's address and its public address
    const box = proc(RUNNER, ['--data-dir', boxDir], {
      HOME: boxDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0',
      ONDERLING_RELAY_URL: relay.url, TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_TELEGRAM_API_ROOT: api.root,
      ONDERLING_FEED_COMPANION: companionAddress, ONDERLING_FEED_BASE_URL: base,
    });
    const botAddress = (await box.waitFor(/address\s+(\S{20,})/))[1];
    // 2 · the companion again, the box as its owner (what the admin does once, on the public box)
    comp = proc(COMPANION, [], compEnv(botAddress));
    await comp.waitFor(/Host agent:/);
    const log = box.log;

    await ask(api, ADMIN, '/start', () => true, { log });
    await ask(api, ADMIN, 'tandarts morgen om 10 uur', (m) => /tandarts/i.test(m.text), { log });
    // off by default: no link
    expect((await ask(api, ADMIN, '/agenda-link', () => true, { log })).all).toMatch(/staat uit/);
    expect((await ask(api, ADMIN, '/huishouden agenda on', () => true, { log })).all).not.toMatch(/niet opgeslagen/);
    const got = await ask(api, ADMIN, '/agenda-link', (m) => /\/feed\//.test(m.text), { log });
    const link = got.all.match(/http:\/\/127\.0\.0\.1:\d+\/feed\/\S+\.ics/)?.[0];
    expect(link, got.all).toBeTruthy();
    expect(got.all).toMatch(/webcal:\/\//);
    const first = await fetchFeed(link);
    expect(first.status, `${first.body}\n${comp.log().slice(-800)}`).toBe(200);
    expect(first.type).toMatch(/^text\/calendar/);
    expect(first.body).toMatch(/SUMMARY:[^\r\n]*[Tt]andarts/);
    expect(first.body).not.toMatch(/ATTENDEE|ORGANIZER/);

    // a new appointment: the link follows, a moment later
    await ask(api, ADMIN, 'kapper overmorgen om 11 uur', (m) => /kapper/i.test(m.text), { log });
    expect(await until(async () => (/[Kk]apper/.test((await fetchFeed(link)).body) ? true : null), { timeout: 20_000, step: 500 }), 'the link follows a change').toBe(true);

    // asked again: a new link, the old one dark
    const again = await ask(api, ADMIN, '/agenda-link', (m) => /\/feed\//.test(m.text), { log });
    const link2 = again.all.match(/http:\/\/127\.0\.0\.1:\d+\/feed\/\S+\.ics/)?.[0];
    expect(link2).toBeTruthy();
    expect(link2).not.toBe(link);
    expect((await fetchFeed(link2)).status).toBe(200);
    expect((await fetchFeed(link)).status, 'the old link is dark').toBe(404);

    // a person with a link, revoked: dark
    await ask(api, ADMIN, '/cohort 1 1', () => true, { log });
    const invite = await ask(api, ADMIN, '/invite', (m) => /\/start \S+/.test(m.text), { log });
    await ask(api, BEA, `/start ${invite.text.match(/\/start (\S+)/)[1]}`, () => true, { name: 'Bea', log });
    const bea = await ask(api, BEA, '/agenda-link', (m) => /\/feed\//.test(m.text), { name: 'Bea', log });
    const beaLink = bea.all.match(/http:\/\/127\.0\.0\.1:\d+\/feed\/\S+\.ics/)?.[0];
    expect((await fetchFeed(beaLink)).body).toMatch(/[Tt]andarts/);
    await ask(api, ADMIN, '/revoke Bea', () => true, { log });
    expect(await until(async () => ((await fetchFeed(beaLink)).status === 404 ? true : null), { timeout: 15_000, step: 500 }), 'revoked: dark').toBe(true);

    // the switch off: every link dark
    await ask(api, ADMIN, '/huishouden agenda off', () => true, { log });
    expect(await until(async () => ((await fetchFeed(link2)).status === 404 ? true : null), { timeout: 15_000, step: 500 }), 'switched off: dark').toBe(true);

    // the companion never logged a link's id or key
    const [, id, k] = /\/feed\/([^.]+)\.([^.]+)\.ics/.exec(link2);
    expect(comp.log()).not.toContain(id);
    expect(comp.log()).not.toContain(k);
    await box.stop(); await comp.stop();
  }, 300_000);
});
