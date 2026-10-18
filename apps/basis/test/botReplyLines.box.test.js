/**
 * THE BOX SAYS ONE LINE PER OP FAMILY — booted for real, against a Bot API server of our own (the box's
 * `ONDERLING_TELEGRAM_API_ROOT`): the admin writes "zet melk op de boodschappen", the box's word rule takes it (no
 * model), and Telegram is sent one line naming the list and the thing. (A comma list is the model's to read since
 * 2026-10-18 — its folded "3 toegevoegd …" line is the scripted-model test's, `telegram/botReplyLines.test.js`.) Then a
 * chore: taken by its words, it says so in one line.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';
import { until } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const ADMIN = '9';

describe('the box words what it did', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('an add by the word rule is one Telegram line; a claimed chore is one line', async () => {
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-reply-lines-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        ONDERLING_PRIMARY_DEVICE: '0', TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_TELEGRAM_API_ROOT: api.root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });

    /** What the box said to one line: every message after it, once it stopped talking. */
    const ask = async (text) => {
      const before = api.said(ADMIN).length;
      api.write(ADMIN, text, 'Frits');
      const got = await until(async () => (api.said(ADMIN).length > before ? true : null), { timeout: 60_000, step: 250 });
      expect(got, `no answer to "${text}":\n${out.slice(-1500)}`).toBe(true);
      let n = -1;
      while (n !== api.said(ADMIN).length) { n = api.said(ADMIN).length; await new Promise((r) => { setTimeout(r, 1200); }); }
      return api.said(ADMIN).slice(before).map((m) => m.text);
    };

    await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    await ask('/start');   // the admin's welcome
    // (a comma list is the model's since 2026-10-18 — this box has none; one thing is the word rule's)
    expect(await ask('zet melk op de boodschappen')).toEqual(['Op de lijst Boodschappen: melk.']);
    await ask('nieuwe taak: lamp vervangen');
    // the claimer hears it once: the store records the person as the claim's writer, so the announcer does not tell
    // them "Voor jou: …" as if someone else had given it to them
    const claimed = await ask('ik doe de lamp');
    expect(claimed).toEqual(["Klusje 'lamp vervangen' is opgepakt."]);
  }, 150_000);
});
