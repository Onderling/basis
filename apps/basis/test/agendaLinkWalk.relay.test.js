/**
 * A PERSON'S AGENDA AS A LINK, walked on real processes: the household's box (the runner, against a Bot API of our own)
 * and the household's companion (its own boot, as the tablet will run it: no port of its own), over one relay that
 * serves the links by forwarding them to the companion. The box holds the companion as a CONTACT — its card, which
 * says where its links are served (seeded here). The companion's OWNER (a person's real agent) claims it with the line
 * it prints and, from their app, GRANTS the box its agenda files: the companion mints one token per op to the box's key
 * and sends them over the relay; the box keeps them and presents one on every put. Then: the switch is off → no link;
 * on → `/agenda-link` sends a link privately, AT THE RELAY, naming the companion; fetching it gives the agenda with the
 * appointment; a new appointment re-renders it; asking again turns the old link dark; `/revoke` turns a person's link
 * dark; and before any of it, the relay's route answers 404.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';
import { startJourneyRelay } from './support/testRelay.js';
import { loadCompanionGrantPicker } from '../src/v2/companionGrant.js';
import { until, bootRealAgentNode, connectNodesOverRelay, teardown } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const COMPANION = fileURLToPath(new URL('../../companion-node/src/boot.js', import.meta.url));
const ADMIN = '9';
const BEA = '22';


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
    // the relay serves the links (`feeds`), as both relay boot doors run it
    const relay = await startJourneyRelay({ feeds: { missFloorMs: 0 } });
    cleanup.push(() => relay.close?.());
    const base = relay.url.replace(/^ws/, 'http');
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const boxDir = mkdtempSync(path.join(tmpdir(), 'agenda-box-'));
    const compDir = mkdtempSync(path.join(tmpdir(), 'agenda-companion-'));
    cleanup.push(() => rmSync(boxDir, { recursive: true, force: true }), () => rmSync(compDir, { recursive: true, force: true }));
    // 0 · the companion, on the relay, no port of its own: its address and its card (where its links are served)
    const comp = proc(COMPANION, [], { COMPANION_RELAY_URL: relay.url, COMPANION_NODE_CONFIG_DIR: compDir, COMPANION_FEEDS: 'on' });
    const companionAddress = (await comp.waitFor(/Host agent:\s+(\S+)/))[1];
    const companionCard = (await comp.waitFor(/Card:\s+(onderling-contact:\/\/\S+)/))[1];
    expect((await fetchFeed(`${base}/feed/${companionAddress}/${'a'.repeat(32)}.${'b'.repeat(43)}.ics`)).status, 'the relay\'s route before any put').toBe(404);

    // 1 · the box, holding the companion as a contact (its card) — no address or URL configured
    const box = proc(RUNNER, ['--data-dir', boxDir], {
      HOME: boxDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0',
      ONDERLING_RELAY_URL: relay.url, TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_TELEGRAM_API_ROOT: api.root,
      ONDERLING_SEEDED_CONTACT_CARD: companionCard,
    });
    const boxAddress = (await box.waitFor(/address\s+(\S{20,})/))[1];
    const log = box.log;
    /** The box's walk log, as entries. */
    const walked = () => readdirSync(boxDir).filter((f) => /^walk-log-.*\.jsonl$/.test(f))
      .flatMap((f) => readFileSync(path.join(boxDir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }));

    // 2 · the companion's owner, in their own app: claims it with the line it printed, adds the box as a contact by the
    // card it prints, and grants it the agenda files from the picker — the box's row there is its address, the key it
    // calls the companion with
    const owner = await bootRealAgentNode('web', {});
    cleanup.push(() => teardown([owner]));
    await connectNodesOverRelay([owner], { relayUrl: relay.url });
    const claimLine = (await comp.waitFor(/Claim:\s+(\S+@\S+)/))[1];
    expect(await owner.agent.callSkill('household', 'claimCompanion', { claim: claimLine })).toMatchObject({ ok: true });
    const boxCard = (await box.waitFor(/(onderling-contact:\/\/\S+)/))[1];
    expect((await owner.agent.callSkill('stoop', 'addContactFromQr', { payload: boxCard }))?.error).toBeUndefined();
    const picker = await loadCompanionGrantPicker({ callSkill: owner.agent.callSkill, node: companionAddress, t: (k) => k });
    expect(picker, JSON.stringify(picker)).toMatchObject({ ok: true, choices: [{ id: 'agenda-files' }] });
    const target = picker.targets.find((x) => x.key === boxAddress);
    expect(target, `the box among the picker's rows: ${JSON.stringify(picker.targets)}`).toBeTruthy();
    const granted = await owner.agent.callSkill('household', 'grantCompanion', { node: companionAddress, to: target.key, families: ['agenda-files'] });
    expect(granted, JSON.stringify(granted)).toMatchObject({ ok: true, ops: ['feed.drop', 'feed.put'] });
    const kept = await until(async () => walked().find((e) => e.kind === 'companion-grant') ?? null, { timeout: 30_000, step: 250 });
    expect(kept, `the box kept the grant\n${log().slice(-1500)}`).toMatchObject({ ok: true, ops: ['feed.drop', 'feed.put'] });

    await ask(api, ADMIN, '/start', () => true, { log });
    await ask(api, ADMIN, 'tandarts morgen om 10 uur', (m) => /tandarts/i.test(m.text), { log });
    // off by default: no link
    expect((await ask(api, ADMIN, '/agenda-link', () => true, { log })).all).toMatch(/staat uit/);
    expect((await ask(api, ADMIN, '/huishouden agenda on', () => true, { log })).all).not.toMatch(/niet opgeslagen/);
    const got = await ask(api, ADMIN, '/agenda-link', (m) => /\/feed\//.test(m.text), { log });
    const link = got.all.match(/http:\/\/127\.0\.0\.1:\d+\/feed\/[A-Za-z0-9_-]{43}\/\S+\.ics/)?.[0];
    expect(link, got.all).toBeTruthy();
    expect(link, 'the link is at the relay and names the companion').toContain(`${base}/feed/${companionAddress}/`);
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
    const link2 = again.all.match(/http:\/\/127\.0\.0\.1:\d+\/feed\/[A-Za-z0-9_-]{43}\/\S+\.ics/)?.[0];
    expect(link2).toBeTruthy();
    expect(link2).not.toBe(link);
    expect((await fetchFeed(link2)).status).toBe(200);
    expect((await fetchFeed(link)).status, 'the old link is dark').toBe(404);

    // a person with a link, revoked: dark
    await ask(api, ADMIN, '/cohort 1 1', () => true, { log });
    const invite = await ask(api, ADMIN, '/invite', (m) => /\/start \S+/.test(m.text), { log });
    await ask(api, BEA, `/start ${invite.text.match(/\/start (\S+)/)[1]}`, () => true, { name: 'Bea', log });
    const bea = await ask(api, BEA, '/agenda-link', (m) => /\/feed\//.test(m.text), { name: 'Bea', log });
    const beaLink = bea.all.match(/http:\/\/127\.0\.0\.1:\d+\/feed\/[A-Za-z0-9_-]{43}\/\S+\.ics/)?.[0];
    expect((await fetchFeed(beaLink)).body).toMatch(/[Tt]andarts/);
    await ask(api, ADMIN, '/revoke Bea', () => true, { log });
    expect(await until(async () => ((await fetchFeed(beaLink)).status === 404 ? true : null), { timeout: 15_000, step: 500 }), 'revoked: dark').toBe(true);

    // the switch off: every link dark
    await ask(api, ADMIN, '/huishouden agenda off', () => true, { log });
    expect(await until(async () => ((await fetchFeed(link2)).status === 404 ? true : null), { timeout: 15_000, step: 500 }), 'switched off: dark').toBe(true);

    // the companion never logged a link's id or key
    const [, id, k] = /\/feed\/[^/]+\/([^.]+)\.([^.]+)\.ics/.exec(link2);
    expect(comp.log()).not.toContain(id);
    expect(comp.log()).not.toContain(k);
    // every put and drop went with the grant's token: the companion refused none of the box's calls
    expect(walked().filter((e) => e.kind === 'companion-call'), 'a call the companion refused').toEqual([]);
    await box.stop(); await comp.stop();
  }, 300_000);
});
