/**
 * A PERSON CONNECTS A SCREEN, IN A REAL BROWSER — the web app opened from the bot's own `/scherm` link.
 *
 * The real box runner as a household bot; Ann in its inbox (a real agent) asks `/scherm`; the link the bot sends her is
 * opened in Chromium. What she would see, in order: the secret leaves the address bar at once; the page names the bot
 * and waits — nothing is sent before her tap; after the tap, a code; the same code in her chat, where she says yes;
 * then the ops this screen may do, and one of them run from the page; a reload acts again without pairing.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/screen-connect-box.spec.js
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from '../test/support/pairRealAgents.js';
import { decodeContactCard } from '@onderling-app/stoop/lib/contactCard';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
// the walk log: beside the data (a box's `walks/` folder, or the data dir itself)
const walkLog = (dir) => [dir, path.join(dir, 'walks')].flatMap((d) => { try { return readdirSync(d).filter((f) => f.startsWith('walk-log-')).map((f) => path.join(d, f)); } catch { return []; } })
  .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));

test('the screen in a browser: the link read and hidden, the tap, the code, the yes, acting, a reload', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-browser-'));
  let out = '';
  const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
    env: {
      PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: R1, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
      ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0', BASIS_APP_URL: appUrl,
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
    await send('hallo', { admission: /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)[1] });
    expect(await until(async () => ((await said()).length ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
    await send('/scherm');
    const linkLine = await until(async () => (await said()).find((x) => x.includes('#scherm=')) ?? null, { timeout: 30_000, step: 500 });
    expect(linkLine, `no link:\n${out.slice(-1200)}`).toBeTruthy();
    const link = /https?:\/\/\S+/.exec(linkLine)[0];

    // ── the page: the secret gone from the address bar, the bot named, nothing sent before the tap ──
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(link);
    await expect(page.locator('[data-screen="connect"]')).toBeVisible({ timeout: 60_000 });
    expect(page.url()).not.toContain('#scherm=');
    expect(page.url()).toContain('#scherm-bot=');
    await page.waitForTimeout(2000);
    const logged = walkLog(dataDir);
    expect(logged.some((e) => e.kind === 'run'), 'the walk log is where the spec reads it').toBe(true);
    expect(logged.some((e) => e.kind === 'screen-offer'), 'the page sent nothing before the tap').toBe(false);

    // ── the tap: a code; the same code in Ann's chat; her yes there ──
    await page.locator('[data-screen="connect"]').click();
    const codeEl = page.locator('[data-code]');
    await expect(codeEl).toBeVisible({ timeout: 30_000 });
    const code = await codeEl.getAttribute('data-code');
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}$/);
    expect(await until(async () => ((await said()).some((x) => /koppelen|connect/i.test(x)) ? true : null), { timeout: 30_000, step: 500 }), 'the question reached her chat').toBe(true);
    await send(`/koppelen ${code}`);   // she picks the code her screen shows

    // ── connected: the ops, and one run from the page ──
    await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 30_000 });
    const run = page.locator('[data-op="lists.listLists"]');
    await expect(run).toBeVisible();
    await run.click();
    await expect(page.locator('li', { has: run }).locator('.screen-result')).toContainText(/Boodschappen|✓/, { timeout: 30_000 });

    // ── a reload: the same browser's key and kept grant act again, no pairing ──
    await page.reload();
    await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 60_000 });
    await ctx.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann).catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
