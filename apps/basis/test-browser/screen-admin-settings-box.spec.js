/**
 * THE ADMIN'S SETTINGS ON THE MANAGEMENT SCREEN, IN A REAL BROWSER — the real box runner as a household bot, Ann (its first person, so
 * its admin) in its inbox, and the web app connected to the bot as her screen in Chromium.
 *
 * What she would see: the admin's section painted; the reads (status, users, settings, exports) answered; an export
 * written; what changes who is in held for her yes — asked in her own chat, with the request's id — and the screen told
 * the outcome (her yes: done; her no: not done); and what a screen never gets is not on it.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/screen-admin-box.spec.js
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from '../test/support/pairRealAgents.js';
import { decodeContactCard } from '@onderling-app/stoop/lib/contactCard';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

test('every setting on the admin\'s settings menu: each button changes it, and the bot says the new value', async ({ browser }, testInfo) => {
  test.setTimeout(900_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-settings-'));
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
    await send('/scherm link');
    const linkLine = await until(async () => (await said()).find((x) => x.includes('#scherm=')) ?? null, { timeout: 30_000, step: 500 });
    expect(linkLine, `no link:\n${out.slice(-1200)}`).toBeTruthy();

    const ctx = await browser.newContext({ locale: 'nl-NL' });
    const page = await ctx.newPage();
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(/https?:\/\/\S+/.exec(linkLine)[0]);
    // the first load of a fresh dev server is slow: wait for the page as the connect walk does
    await expect(page.locator('[data-screen="connect"]')).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-screen="connect"]').click();
    const code = await page.locator('[data-code]').getAttribute('data-code', { timeout: 30_000 });
    expect(await until(async () => ((await said()).some((x) => /koppelen|connect/i.test(x)) ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
    await send(`/koppelen ${code}`);
    await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 30_000 });

    // ── the settings menu: every button it offers, tapped once, and what the bot answered ──
    const menuOp = page.locator('.screen-op', { has: page.locator('[data-op="assistant.assistant-menu"]') });
    const openMenu = async () => {
      await page.waitForTimeout(Number(process.env.SETTINGS_PACE_MS ?? 1_200));   // a person's pace (the screen's burst cap)
      await page.locator('[data-op="assistant.assistant-menu"]').click();
      await expect(menuOp.locator('[data-reply]').first()).toBeVisible({ timeout: 30_000 });
    };
    await openMenu();
    // (not the language: switched to English, every later label would be another word)
    const labels = (await menuOp.locator('[data-reply]').allTextContents()).filter((l) => !l.includes('✓') && !/^Taal/.test(l));
    testInfo.annotations.push({ type: 'buttons', description: JSON.stringify(labels) });
    const results = [];
    for (const label of labels) {
      await openMenu();
      const btn = menuOp.locator('[data-reply]', { hasText: label }).first();
      if (!(await btn.count())) { results.push({ label, answer: '(button gone)' }); continue; }
      const before = await menuOp.locator('.screen-result').textContent();
      await btn.click();
      await expect(menuOp.locator('.screen-result')).not.toHaveText(before ?? '', { timeout: 30_000 }).catch(() => {});
      await expect(menuOp.locator('.screen-result')).not.toHaveText(/^(…)?$/, { timeout: 30_000 });
      results.push({ label, answer: (await menuOp.locator('.screen-result').textContent()).replace(/\n+/g, ' | ') });
    }
    // after all of it, the menu as it stands: each row's ✓ where the last tap put it
    await openMenu();
    const finalMenu = await menuOp.locator('.screen-result').textContent();
    testInfo.annotations.push({ type: 'results', description: JSON.stringify(results) });
    testInfo.annotations.push({ type: 'final', description: finalMenu });
    console.log('SETTINGS-WALK', JSON.stringify({ results, finalMenu }, null, 1));
    const failed = results.filter((r) => /lukte niet|niet gelukt|niet opgeslagen|alleen voor|Even rustig|refused|\(button gone\)/i.test(r.answer));
    expect(failed, JSON.stringify(failed)).toEqual([]);
    // and each setting stands where its last tap put it (an answer without an error is not yet a change)
    const lastPerRow = new Map(labels.map((l) => [l.split(':')[0], l]));
    const finalLines = finalMenu.split('\n').map((l) => l.trim());
    expect([...lastPerRow.values()].filter((l) => !finalLines.includes(l))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
    await ctx.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann).catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
