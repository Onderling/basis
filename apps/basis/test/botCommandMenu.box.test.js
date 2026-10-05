/**
 * THE BOX HANDS TELEGRAM ITS MENU — booted for real, against a Bot API server of our own (the box's
 * `ONDERLING_TELEGRAM_API_ROOT`, as Telegram's self-hosted server would be named): once the door runs, every private
 * chat gets the member's commands (Dutch, and English for an English app), and when the admin first writes, their chat
 * gets the admin's.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

describe('the box publishes Telegram menus', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('the member list for every private chat (nl, en) and the admin list on the admin chat', async () => {
    const api = await fakeBotApi();
    cleanup.push(api.close);
    api.write('9', '/start', 'Frits');
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-menu-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: '9', ONDERLING_TELEGRAM_API_ROOT: api.root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });
    const sets = () => api.calls.filter((c) => c.method === 'setMyCommands');
    const t0 = Date.now();
    while (Date.now() - t0 < 90_000 && !sets().some((c) => c.args.scope?.type === 'chat')) await new Promise((r) => { setTimeout(r, 300); });
    const all = sets();
    expect(all.length, `no menus published:\n${out.slice(-1500)}`).toBeGreaterThan(0);
    const dflt = all.find((c) => c.args.scope?.type === 'all_private_chats' && !c.args.language_code);
    const english = all.find((c) => c.args.scope?.type === 'all_private_chats' && c.args.language_code === 'en');
    const admin = all.find((c) => c.args.scope?.type === 'chat' && String(c.args.scope.chat_id) === '9');
    expect(dflt && english && admin, JSON.stringify(all.map((c) => c.args.scope))).toBeTruthy();
    const names = (c) => c.args.commands.map((x) => x.command);
    expect(names(dflt)).toContain('instellingen');
    expect(names(dflt)).not.toContain('huishouden');
    expect(names(admin)).toContain('huishouden');
    expect(english.args.commands.find((x) => x.command === 'instellingen').description)
      .not.toBe(dflt.args.commands.find((x) => x.command === 'instellingen').description);
  }, 120_000);
});
