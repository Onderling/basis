/**
 * THE EXPORT KEY FROM THE ADMIN'S SCREEN, IN A REAL BROWSER — the real box runner as a household bot, Ann (its admin)
 * in its inbox, her screen in Chromium. She sets the key on her screen (a password field), says yes in her own chat,
 * and the next export is sealed; a wrong passphrase does not open it; the right one opens it for the /import in her
 * chat (its question counts what the file holds). Afterwards the passphrase is in none of the box's files and not in the screen's storage.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/screen-export-key-box.spec.js
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from '../test/support/pairRealAgents.js';
import { decodeContactCard } from '@onderling-app/stoop/lib/contactCard';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const PASS = 'een geheime zin voor de export 7';
const allFiles = (dir) => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? allFiles(p) : [p]; });

test('the export key from the screen: set and unlocked after a yes in her chat; the passphrase is kept nowhere', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-exportkey-'));
  let out = '';
  const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
    env: {
      PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: R1, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
      ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0', BASIS_APP_URL: appUrl, ONDERLING_WALK_LOG_TURNS: 'full',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => { out += String(b); });
  child.stderr.on('data', (b) => { out += String(b); });
  let ann = null;
  try {
    expect(await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 300 }), `the bot never came up:\n${out.slice(-1500)}`).toBe(true);
    const card = decodeContactCard(/onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(out)[1]);
    ann = await bootRealAgentNode('ann', { contactChannel: true });
    await connectNodesOverRelay([ann], { relayUrl: R1 });
    const said = async () => (await ann.contactThreadChannel.rehydrateAll()).filter((x) => x.origin === 'bot').map((x) => x.text);
    const send = (text, extra = {}) => ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
    const next = async (from, re) => until(async () => (await said()).slice(from).find((x) => re.test(x)) ?? null, { timeout: 30_000, step: 500 });
    await send('hallo', { admission: /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)[1] });
    expect(await until(async () => ((await said()).length ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
    await send('/scherm link');
    const linkLine = await next(0, /#scherm=/);

    const ctx = await browser.newContext({ locale: 'nl-NL' });
    const page = await ctx.newPage();
    const consoleLines = [];
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
    page.on('pageerror', (e) => consoleLines.push(`pageerror: ${String(e?.message ?? e).slice(0, 200)}`));
    await page.goto(/https?:\/\/\S+/.exec(linkLine)[0]);
    // a probe that names its branch: when the page never shows the connect button, say what it showed instead
    const shown = await page.locator('[data-screen="connect"]').waitFor({ state: 'visible', timeout: 60_000 }).then(() => null, async () => `${(await page.locator('body').innerText().catch(() => '')).slice(0, 300)}\n${consoleLines.slice(-8).join('\n')}`);
    expect(shown, `the screen page did not offer to connect:\n${shown}`).toBeNull();
    await page.locator('[data-screen="connect"]').click();
    const code = await page.locator('[data-code]').getAttribute('data-code', { timeout: 30_000 });
    expect(await next(0, /koppelen|connect/i)).toBeTruthy();
    await send(`/koppelen ${code}`);
    await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 30_000 });

    const opOf = (skill) => page.locator('.screen-op', { has: page.locator(`[data-op="${skill}"]`) });
    // a passphrase into the op's form — a password field — and the yes in Ann's own chat (the request's id in the words)
    const askAndSayYes = async (skill, passphrase, re) => {
      const from = (await said()).length;
      await page.locator(`[data-op="${skill}"]`).click();
      const field = opOf(skill).locator('input[name="passphrase"]');
      await expect(field).toHaveAttribute('type', 'password');
      await field.fill(passphrase);
      // the set asks it twice (both secret fields); the unlock once
      const again = opOf(skill).locator('input[name="passphraseAgain"]');
      if (await again.count()) { await expect(again).toHaveAttribute('type', 'password'); await again.fill(passphrase); }
      await opOf(skill).locator('.cc-form-submit').first().click();
      await expect(opOf(skill).locator('.screen-result')).toContainText(/eigen chat/, { timeout: 30_000 });
      const q = await next(from, re);
      expect(q, `no question in her chat:\n${(await said()).slice(from).join('\n')}`).toBeTruthy();
      expect(q).not.toContain(passphrase);
      const after = (await said()).length;
      await send(`/bevestig ja ${/\/bevestig ja ([A-Z2-9]{4})/.exec(q)[1]}`);
      return next(after, /./);
    };

    // ── set: nothing on the box before the yes; after it, the key; the next export is sealed ──
    expect(existsSync(path.join(dataDir, 'export-key.json'))).toBe(false);
    const set = await askAndSayYes('assistant.assistant-export-key-set', PASS, /exportsleutel zetten/);
    expect(set).toMatch(/exportsleutel staat erop/);
    expect(existsSync(path.join(dataDir, 'export-key.json'))).toBe(true);
    await page.waitForTimeout(1_200);
    await page.locator('[data-op="assistant.assistant-export"]').click();
    await expect(opOf('assistant.assistant-export').locator('.screen-result')).toContainText(/verzegeld/, { timeout: 30_000 });
    await expect(opOf('assistant.assistant-export').locator('.screen-result')).not.toContainText(/niet verzegeld/);

    // ── unlock: a wrong passphrase does not open it; the right one does, for the hour ──
    await page.waitForTimeout(1_200);
    const wrong = await askAndSayYes('assistant.assistant-export-key-unlock', 'dit is niet de goede zin', /exportsleutel een uur openen/);
    expect(wrong).toMatch(/opent deze sleutel niet/);
    expect(existsSync(path.join(dataDir, 'export-key.unlocked'))).toBe(false);
    await page.waitForTimeout(1_200);
    const right = await askAndSayYes('assistant.assistant-export-key-unlock', PASS, /exportsleutel een uur openen/);
    expect(right).toMatch(/een uur open/);
    expect(existsSync(path.join(dataDir, 'export-key.unlocked'))).toBe(true);

    // ── …and the /import in her chat opens the sealed file (its question counts what it holds) ──
    const file = readdirSync(path.join(dataDir, 'exports')).filter((n) => n.startsWith('household-export-')).sort().pop();
    const from = (await said()).length;
    await send(`/import ${file}`);
    const preview = await next(from, /./);
    expect(preview, 'the sealed file opened').not.toMatch(/dicht|op slot|locked/i);
    expect(preview).toMatch(/\d/);

    // ── the passphrase is in none of the box's files, and not in the screen's storage ──
    const holding = allFiles(dataDir).filter((f) => { try { return readFileSync(f).includes(Buffer.from(PASS)); } catch { return false; } });
    expect(holding.map((f) => path.relative(dataDir, f)), 'files holding the passphrase').toEqual([]);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
    expect(stored).not.toContain(PASS);
    await ctx.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann).catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
