/**
 * THE HOUSEHOLD COMES BACK ON A NEW BOX — the restore walked headless, the way an admin would do it: two real runners
 * against a Bot API server of our own. Box A: the admin writes, puts a line on a list and lets one person in; the export
 * key is set on the box; `/export` puts a sealed file on the shelf. Box B: an EMPTY data dir and so a NEW identity;
 * before anything it knows neither the line nor the person; the file is copied onto its shelf, its key opened on the
 * box from the file (`export-key.mjs unlock --from`), `/import` asks with what the file holds, the yes reads it back —
 * and B shows the same line, the same person, and the switches the household keeps as planned rows (a person's week
 * overview, an announcement switched off), with nothing said to be lost.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';
import { startJourneyRelay } from './support/testRelay.js';
import { until } from './support/pairRealAgents.js';
import { createExportKeyFile } from '../src/v2/exportKeyFile.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const ADMIN = '9';
const BEA = '22';
const PASSPHRASE = 'a test passphrase, long enough';

/** The box's own key files, as `bin/export-key.mjs` reaches them. */
const keyOn = (dataDir) => createExportKeyFile({
  files: {
    read: (name) => { try { return readFileSync(path.join(dataDir, name), 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; } },
    write: (name, text) => writeFileSync(path.join(dataDir, name), text, { mode: 0o600 }),
    remove: (name) => rmSync(path.join(dataDir, name), { force: true }),
  },
});

describe('the household restore, on two real boxes', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  /** One box: its data dir and its Telegram (our fake). */
  async function box(label) {
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const dataDir = mkdtempSync(path.join(tmpdir(), `basis-restore-${label}-`));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    return { api, dataDir };
  }
  /** The runner on that box, its door over the relay. */
  function boot({ api, dataDir }, relayUrl) {
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        ONDERLING_PRIMARY_DEVICE: '0', ONDERLING_RELAY_URL: relayUrl,
        TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_TELEGRAM_API_ROOT: api.root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    const stop = () => new Promise((r) => { if (child.exitCode != null) return r(); child.once('exit', r); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); }, 10_000); });
    cleanup.push(() => { child.kill('SIGKILL'); });
    return { stop, log: () => out };
  }
  /**
   * Write as a person; wait for the bot's line that passes `test`, then until it is quiet (a door may answer in more
   * than one message) — and hand back everything it said to that line, joined, so a check reads the whole answer.
   */
  async function ask(api, uid, text, test = () => true, { name = 'Frits', log = () => '' } = {}) {
    const before = api.said(uid).length;
    api.write(uid, text, name);
    const got = await until(async () => api.said(uid).slice(before).find((m) => test(m)) ?? null, { timeout: 60_000, step: 250 });
    expect(got, `no answer to "${text}" (said: ${JSON.stringify(api.said(uid).slice(before).map((m) => m.text))})\n${log().slice(-1500)}`).toBeTruthy();
    let n = -1;
    while (n !== api.said(uid).length) { n = api.said(uid).length; await new Promise((r) => { setTimeout(r, 1200); }); }
    const all = api.said(uid).slice(before);
    return { ...got, all: all.map((m) => m.text).join('\n') };
  }
  const said = (api, uid) => api.said(uid).map((m) => m.text).join('\n');

  it('export on A, a new box B, import: the same line and the same person', async () => {
    const relay = await startJourneyRelay();
    cleanup.push(() => relay.close?.());

    // ── box A: the household as it was ──
    const a = await box('a');
    // the export key, set on the box (`export-key.mjs set`): the nightly files are sealed, as on the tablet
    expect((await keyOn(a.dataDir).set(PASSPHRASE)).ok).toBe(true);
    const runA = boot(a, relay.url);
    await ask(a.api, ADMIN, '/start', () => true, { log: runA.log });
    await ask(a.api, ADMIN, 'zet havermelk op de boodschappenlijst', (m) => /havermelk/i.test(m.text), { log: runA.log });
    // the door is open for exactly the people expected (one), then that person's own code
    await ask(a.api, ADMIN, '/cohort 1 1', () => true, { log: runA.log });
    const invite = await ask(a.api, ADMIN, '/invite', (m) => /\/start \S+/.test(m.text), { log: runA.log });
    const code = invite.text.match(/\/start (\S+)/)[1];
    await ask(a.api, BEA, `/start ${code}`, () => true, { name: 'Bea', log: runA.log });
    const usersA = await ask(a.api, ADMIN, '/users', (m) => /Bea/.test(m.text), { log: runA.log });
    expect(usersA.all).toContain('Bea');
    // the switches the household keeps as planned rows: Bea's own week overview on, the chore announcements off
    await ask(a.api, BEA, '/overzicht aan', () => true, { name: 'Bea', log: runA.log });
    await ask(a.api, ADMIN, '/huishouden announce chores off', () => true, { log: runA.log });
    const plannedA = (await ask(a.api, BEA, '/gepland', () => true, { name: 'Bea', log: runA.log })).all;
    expect(plannedA, 'the overview is on for Bea').toMatch(/overzicht/i);
    const written = await ask(a.api, ADMIN, '/export', (m) => /household-export-[\d-]+\.json/.test(m.text), { log: runA.log });
    const name = written.text.match(/household-export-[\d-]+\.json/)[0];
    expect(written.text, 'sealed: the key was set').toMatch(/verzegeld|sealed/i);
    await runA.stop();

    // ── box B: empty, so a new identity ──
    const b = await box('b');
    const runB = boot(b, relay.url);
    await ask(b.api, ADMIN, '/start', () => true, { log: runB.log });
    // red first: B knows neither the line nor the person
    const emptyList = await ask(b.api, ADMIN, 'wat staat er op de boodschappen', () => true, { log: runB.log });
    expect(emptyList.all, 'a read of the list, not a refusal').toMatch(/Boodschappen/);
    expect(emptyList.all).not.toMatch(/havermelk/i);
    const emptyUsers = await ask(b.api, ADMIN, '/users', () => true, { log: runB.log });
    expect(emptyUsers.all).not.toContain('Bea');

    // the file onto B's shelf; its key opened on the box from the file itself (`export-key.mjs unlock --from <file>`)
    mkdirSync(path.join(b.dataDir, 'exports'), { recursive: true });
    copyFileSync(path.join(a.dataDir, 'exports', name), path.join(b.dataDir, 'exports', name));
    const source = JSON.parse(readFileSync(path.join(b.dataDir, 'exports', name), 'utf8'));
    expect((await keyOn(b.dataDir).unlock(PASSPHRASE, { source })).ok).toBe(true);

    // /import asks first, with what the file holds; the yes reads it back
    const question = await ask(b.api, ADMIN, `/import ${name}`, (m) => Boolean(m.reply_markup?.inline_keyboard), { log: runB.log });
    expect(question.text).toContain(name);
    const yes = question.reply_markup.inline_keyboard.flat().find((x) => x.callback_data && !/nee|no\b|annuleer|cancel/i.test(x.text));
    expect(yes, JSON.stringify(question.reply_markup)).toBeTruthy();
    const before = b.api.said(ADMIN).length;
    b.api.tap(ADMIN, yes.callback_data, 'Frits');
    const done = await until(async () => b.api.said(ADMIN).slice(before).find((m) => /Teruggezet|Restored/i.test(m.text)) ?? null, { timeout: 60_000, step: 250 });
    expect(done, `no import answer: ${said(b.api, ADMIN).slice(-800)}\n${runB.log().slice(-1500)}`).toBeTruthy();

    // nothing the household had is said to be lost
    expect(done.text).not.toMatch(/niet terugzetten/);
    // B now shows the same line, the same person, and the same switches
    const list = await ask(b.api, ADMIN, 'wat staat er op de boodschappen', () => true, { log: runB.log });
    expect(list.all).toMatch(/havermelk/i);
    const users = await ask(b.api, ADMIN, '/users', () => true, { log: runB.log });
    expect(users.all).toContain('Bea');
    // Bea's first line to the new box is greeted; then her planned work reads as it did on A
    await ask(b.api, BEA, '/start', () => true, { name: 'Bea', log: runB.log });
    expect((await ask(b.api, BEA, '/gepland', () => true, { name: 'Bea', log: runB.log })).all).toBe(plannedA);
    await runB.stop();
  }, 300_000);
});
