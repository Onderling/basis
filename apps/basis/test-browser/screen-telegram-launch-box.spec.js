/**
 * A SCREEN OPENED INSIDE TELEGRAM, IN A REAL BROWSER — the real box runner as a household bot on Telegram (a Bot API
 * server of our own), and the web app opened the way Telegram opens it for the "Open het scherm" button: the bot in the
 * query, Telegram's signed launch data in the fragment.
 *
 * What the person would see: connected at once, no code to pick. And what nobody else gets: the same launch opened
 * again is refused, a Telegram id the bot does not know is refused, and a second launch replaces the first — the first
 * screen no longer acts, and the person is told in their chat.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/screen-telegram-launch-box.spec.js
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { until } from '../test/support/pairRealAgents.js';
import { fakeBotApi } from '../test/support/fakeBotApi.js';
import { encodeScreenLaunchLink, parseScreenLink } from '../src/v2/botScreens.js';
import { telegramLaunchHash } from '../src/v2/telegramLaunch.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const TOKEN = '123456:test-only-token';

async function launchData(id, queryId) {
  const p = new URLSearchParams();
  p.set('query_id', queryId);
  p.set('user', JSON.stringify({ id, first_name: 'Frits' }));
  p.set('auth_date', String(Math.floor(Date.now() / 1000)));
  p.set('hash', await telegramLaunchHash(p, TOKEN));
  return p.toString();
}

test('a screen opened inside Telegram connects without a code; a replay, a stranger and an older screen do not act', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const api = await fakeBotApi();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-launch-'));
  let out = '';
  const walks = path.join(dataDir, 'walks') + path.sep;
  const launches = () => readdirSync(walks).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(path.join(walks, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((e) => e.kind === 'screen-launch');
  const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir, '--walk-log', walks], {
    env: {
      PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: R1, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
      ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0', BASIS_APP_URL: appUrl,
      TG_BOT_TOKEN: TOKEN, TG_ADMIN_UID: '9', ONDERLING_TELEGRAM_API_ROOT: api.root,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => { out += String(b); });
  child.stderr.on('data', (b) => { out += String(b); });
  try {
    expect(await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 300 }), `the bot never came up:\n${out.slice(-1500)}`).toBe(true);
    // Frits writes first (the bot's named admin), then asks for a screen: the link says where the bot is
    api.write('9', '/start', 'Frits');
    expect(await until(async () => (api.said('9').length ? true : null), { timeout: 30_000, step: 300 }), `no welcome:\n${out.slice(-1200)}`).toBe(true);
    api.write('9', '/scherm link', 'Frits');
    const linkText = await until(async () => api.said('9').map((m) => m.text).find((x) => x.includes('#scherm=')) ?? null, { timeout: 30_000, step: 300 });
    const where = parseScreenLink(/https?:\/\/\S+/.exec(linkText)[0]);
    expect(where.ok).toBe(true);
    const opened = (initData) => `${encodeScreenLaunchLink(appUrl, { botAddress: where.botAddress, relayUrl: where.relayUrl })}#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;
    const before = api.said('9').length;

    // ── opened inside Telegram: connected at once, no code asked in the chat ──
    const first = await launchData(9, 'first');
    const ctx1 = await browser.newContext({ locale: 'nl-NL' });
    const page1 = await ctx1.newPage();
    await page1.goto(opened(first));
    await expect(page1.locator('[data-screen="connected"]')).toBeVisible({ timeout: 90_000 });
    expect(api.said('9').slice(before).some((m) => JSON.stringify(m.reply_markup ?? {}).includes('/koppelen')), 'no code to pick').toBe(false);
    // it acts: the settings menu answers
    await page1.locator('[data-op="assistant.assistant-menu"]').click();
    await expect(page1.locator('.screen-op', { has: page1.locator('[data-op="assistant.assistant-menu"]') }).locator('[data-reply]').first()).toBeVisible({ timeout: 30_000 });

    // ── the same launch opened again (another browser): refused ──
    const ctx2 = await browser.newContext({ locale: 'nl-NL' });
    const replay = await ctx2.newPage();
    await replay.goto(opened(first));
    await expect(replay.locator('[data-screen="launch_refused"]')).toBeVisible({ timeout: 60_000 });

    // ── a Telegram id the bot does not know: refused ──
    const ctx3 = await browser.newContext({ locale: 'nl-NL' });
    const stranger = await ctx3.newPage();
    await stranger.goto(opened(await launchData(77, 'stranger')));
    await expect(stranger.locator('[data-screen="launch_refused"]')).toBeVisible({ timeout: 60_000 });

    // ── a second launch (a webview that lost its storage): connected; the first screen no longer acts; Frits is told ──
    const ctx4 = await browser.newContext({ locale: 'nl-NL' });
    const page2 = await ctx4.newPage();
    await page2.goto(opened(await launchData(9, 'second')));
    await expect(page2.locator('[data-screen="connected"]')).toBeVisible({ timeout: 90_000 });
    expect(await until(async () => (api.said('9').some((m) => /vorige Telegram-scherm/.test(m.text)) ? true : null), { timeout: 30_000, step: 300 }), 'told in the chat').toBe(true);
    const menu1 = page1.locator('.screen-op', { has: page1.locator('[data-op="assistant.assistant-menu"]') });
    await page1.locator('[data-op="assistant.assistant-menu"]').click();
    await expect(menu1.locator('.screen-result')).not.toHaveText(/^(…)?$/, { timeout: 30_000 });
    await expect(menu1.locator('[data-reply]')).toHaveCount(0);
    const firstSays = await menu1.locator('.screen-result').textContent();
    testInfo.annotations.push({ type: 'first screen after the second launch', description: firstSays });
    // the box's own record of each launch, by the rule that decided it (never the launch data)
    expect(launches().map((e) => (e.ok ? 'granted' : e.reason))).toEqual(['granted', 'used', 'stranger', 'granted']);
    expect(JSON.stringify(launches())).not.toContain('auth_date');
    await page2.screenshot({ path: testInfo.outputPath('launched.png'), fullPage: true });
    for (const c of [ctx1, ctx2, ctx3, ctx4]) await c.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await api.close().catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
