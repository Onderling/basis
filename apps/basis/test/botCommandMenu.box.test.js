/**
 * THE BOX HANDS TELEGRAM ITS MENU — booted for real, against a Bot API server of our own (the box's
 * `ONDERLING_TELEGRAM_API_ROOT`, as Telegram's self-hosted server would be named): once the door runs, every private
 * chat gets the member's commands (Dutch, and English for an English app), and when the admin first writes, their chat
 * gets the admin's.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

/** A Bot API that answers what the box asks: who it is, one `/start` from the admin, and the menus it is handed (kept). */
function fakeBotApi() {
  const calls = [];
  let delivered = false;
  const start = { update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }], chat: { id: 9, type: 'private', first_name: 'Frits' }, from: { id: 9, is_bot: false, first_name: 'Frits' } } };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (b) => { body += b; });
    req.on('end', () => {
      const method = req.url.split('/').pop().split('?')[0];
      let args = {}; try { args = body ? JSON.parse(body) : {}; } catch { /* a form body: not ours */ }
      calls.push({ method, args });
      const result = method === 'getMe' ? { id: 1, is_bot: true, first_name: 'Huis', username: 'huisbot' }
        : method === 'getUpdates' ? (delivered ? [] : (delivered = true, [start]))
        : method === 'sendMessage' ? { message_id: 2, date: 0, chat: { id: args.chat_id, type: 'private' }, text: args.text } : true;
      const answer = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
      if (method === 'getUpdates') setTimeout(answer, 500); else answer();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ calls, server, root: `http://127.0.0.1:${server.address().port}` })));
}

describe('the box publishes Telegram menus', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('the member list for every private chat (nl, en) and the admin list on the admin chat', async () => {
    const api = await fakeBotApi();
    cleanup.push(() => new Promise((r) => api.server.close(r)));
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
