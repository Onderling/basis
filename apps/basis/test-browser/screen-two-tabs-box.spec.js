/**
 * TWO TABS OF ONE SCREEN (live bug L196, Frits' tablet 2026-10-05): every browser tab of the screen shares the same key
 * (one browser's storage). `/scherm` again opens a NEW tab, which pairs again — the bot supersedes the key's earlier
 * grant — while the earlier tab, still open, keeps calling: with superseded tokens ("Token has been revoked"), and, two
 * relay connections under one key, its handshakes answered to the other tab ("did not respond with HI").
 *
 * What a person must see: the newest tab is THE screen and works; an older tab says plainly that the screen is open in
 * another window, with a way to take it back — never a token error, never a handshake timeout.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/screen-two-tabs-box.spec.js
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from '../test/support/pairRealAgents.js';
import { decodeContactCard } from '@onderling-app/stoop/lib/contactCard';
import { addBoxCard } from '../test/support/addBoxCard.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

test('two tabs of one screen: the newest works; the older says so plainly, and takes it back on a tap', async ({ browser }, testInfo) => {
  test.setTimeout(600_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-tabs-'));
  let out = '';
  const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
    env: { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: R1, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0', BASIS_APP_URL: appUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => { out += String(b); });
  child.stderr.on('data', (b) => { out += String(b); });
  let ann = null;
  try {
    expect(await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 300 })).toBe(true);
    const card = decodeContactCard(/onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(out)[1]);
    ann = await bootRealAgentNode('ann', { contactChannel: true });
    await connectNodesOverRelay([ann], { relayUrl: R1 });
    const said = async () => (await ann.contactThreadChannel.rehydrateAll()).filter((x) => x.origin === 'bot').map((x) => x.text);
    const send = (text, extra = {}) => ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
    await addBoxCard(ann, out);   // the box is a contact whose card says it is a bot: the app signs its /start
    await send(`/start ${/\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)[1]}`);
    expect(await until(async () => ((await said()).length ? true : null), { timeout: 30_000, step: 500 })).toBe(true);

    // one browser (one storage, one key): each /scherm link opened in a tab of its own, as Telegram opens it
    const ctx = await browser.newContext({ locale: 'nl-NL' });
    ctx.on('dialog', (d) => d.accept());
    const pairInNewTab = async () => {
      const seen = (await said()).length;
      await send('/scherm link');
      const line = await until(async () => (await said()).slice(seen).find((x) => x.includes('#scherm=')) ?? null, { timeout: 30_000, step: 500 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log('TWO-TABS pageerror:', String(e?.message ?? e).slice(0, 200)));
      page.on('console', (m) => { if (m.type() === 'error') console.log('TWO-TABS console:', m.text().slice(0, 200)); });
      await page.goto(/https?:\/\/\S+/.exec(line)[0]);
      await expect(page.locator('[data-screen="connect"]'), 'the link page offers to connect').toBeVisible({ timeout: 60_000 }).catch(async (e) => { console.log('TWO-TABS page says:', (await page.locator('body').innerText()).slice(0, 300)); throw e; });
      const before = (await said()).length;   // counted BEFORE the tap: a quick bot asks before the code is read
      await page.locator('[data-screen="connect"]').click();
      const code = await page.locator('[data-code]').getAttribute('data-code', { timeout: 30_000 });
      expect(await until(async () => ((await said()).slice(before).some((x) => /koppelen|connect/i.test(x)) ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
      await send(`/koppelen ${code}`);
      await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 30_000 });
      return page;
    };
    const menuAnswer = async (page) => {
      const op = page.locator('.screen-op', { has: page.locator('[data-op="assistant.assistant-menu"]') });
      await page.locator('[data-op="assistant.assistant-menu"]').click();
      await expect(op.locator('.screen-result')).not.toHaveText(/^(…)?$/, { timeout: 40_000 });
      return { text: await op.locator('.screen-result').textContent(), buttons: await op.locator('[data-reply]').count() };
    };

    const first = await pairInNewTab();
    expect((await menuAnswer(first)).buttons, 'the first tab acts').toBeGreaterThan(0);
    console.log('TWO-TABS: first paired');
    const second = await pairInNewTab();
    console.log('TWO-TABS: second paired');
    // the newest tab is THE screen: it acts
    const fresh = await menuAnswer(second);
    expect(fresh.buttons, `the new tab acts: ${fresh.text}`).toBeGreaterThan(0);
    // the older tab: no token error, no handshake timeout — it says the screen is open elsewhere
    await expect(first.locator('[data-screen="elsewhere"]')).toBeVisible({ timeout: 15_000 });
    expect(await first.locator('body').textContent()).not.toMatch(/revoked|did not respond with HI/i);
    // taking it back in the older tab makes THAT the screen, and it acts again
    await first.locator('[data-screen="take-back"]').click();
    const back = await menuAnswer(first);
    expect(back.buttons, `taken back: ${back.text}`).toBeGreaterThan(0);
    await expect(second.locator('[data-screen="elsewhere"]')).toBeVisible({ timeout: 15_000 });
    await ctx.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann).catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
