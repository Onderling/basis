/**
 * THE BOT TOKEN NEVER REACHES A LOG — booted for real against a Telegram API root that refuses every connection, so every
 * call fails with a fetch error whose message IS the request URL, token included (the household box wrote such a
 * message into 50 walk-log lines on 2026-10-18). The box gives up on its long-poll and exits; nothing it wrote, to its
 * walk log or its console, holds the token, and the stop names its error as codes.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const SECRET = 'AAHneverLOGthisTOKENvalue0123456789';

/** A port nothing listens on: bound once to learn a free number, then closed. */
const closedPort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

describe('the bot token never reaches a log', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('every Telegram call fails: the box exits, and neither its walk log nor its console holds the token', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-token-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const walks = path.join(dataDir, 'walks') + path.sep;
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir, '--walk-log', walks], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        TG_BOT_TOKEN: `123456:${SECRET}`, TG_ADMIN_UID: '9', ONDERLING_TELEGRAM_API_ROOT: `http://127.0.0.1:${await closedPort()}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => resolve('timeout'), 90_000);
      child.on('exit', (c) => { clearTimeout(t); resolve(c); });
    });
    // no relay here, so nothing holds the loop and the box ends on its own (0); on a box with a relay the exit is 1
    expect(code, `the box did not stop on a dead long-poll:\n${out.slice(-1500)}`).not.toBe('timeout');
    const lines = readdirSync(walks).flatMap((f) => readFileSync(path.join(walks, f), 'utf8').split('\n').filter(Boolean));
    expect(out).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain(SECRET);
    const down = lines.map((l) => JSON.parse(l)).find((e) => e.kind === 'telegram-down');
    expect(down, lines.join('\n').slice(-1500)).toMatchObject({ reason: 'stopped' });
    expect(down.error?.name ?? down.error?.code, JSON.stringify(down)).toBeTruthy();
  }, 120_000);

  it('the menu and the replies fail on the network while the poll works: the failures are logged, the token is not', async () => {
    const api = await fakeBotApi({ dropMethods: ['setMyCommands', 'sendMessage'] });
    cleanup.push(api.close);
    api.write('9', '/start', 'Frits');
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-token-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const walks = path.join(dataDir, 'walks') + path.sep;
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir, '--walk-log', walks], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        TG_BOT_TOKEN: `123456:${SECRET}`, TG_ADMIN_UID: '9', ONDERLING_TELEGRAM_API_ROOT: api.root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });
    const lines = () => { try { return readdirSync(walks).flatMap((f) => readFileSync(path.join(walks, f), 'utf8').split('\n').filter(Boolean)); } catch { return []; } };
    const failedMenu = () => lines().some((l) => /"kind":"command-menu","ok":false/.test(l));
    const t0 = Date.now();
    while (Date.now() - t0 < 90_000 && !failedMenu()) await new Promise((r) => { setTimeout(r, 300); });
    expect(failedMenu(), `the menu's failure was not reached:\n${out.slice(-1500)}`).toBe(true);
    await new Promise((r) => { setTimeout(r, 3000); });   // the admin's /start turn, whose reply fails the same way
    expect(out).not.toContain(SECRET);
    expect(lines().join('\n')).not.toContain(SECRET);
  }, 120_000);

  it('a credential in a URL that does NOT go through Telegraf (the relay address): the box floors take it out', async () => {
    // Telegraf redacts its own fetch errors, so the two cases above pin the outcome; this one pins the floors: the relay
    // address is printed in the start banner and written to the walk log by the box itself.
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-token-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const walks = path.join(dataDir, 'walks') + path.sep;
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir, '--walk-log', walks], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
        ONDERLING_RELAY_URL: `ws://127.0.0.1:${await closedPort()}/bot123456:${SECRET}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });
    const lines = () => { try { return readdirSync(walks).flatMap((f) => readFileSync(path.join(walks, f), 'utf8').split('\n').filter(Boolean)); } catch { return []; } };
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000 && !(/device-runner: up/.test(out) && lines().length > 3)) await new Promise((r) => { setTimeout(r, 300); });
    expect(/device-runner: up/.test(out), out.slice(-1500)).toBe(true);
    expect(out).toContain('/bot\u27e8redacted\u27e9');   // the address was printed, its credential replaced
    expect(out).not.toContain(SECRET);
    expect(lines().join('\n')).not.toContain(SECRET);
  }, 90_000);
});
