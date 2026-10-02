/**
 * THE ADMIN'S MANAGEMENT SCREEN, IN A REAL BROWSER — the real box runner as a household bot, Ann (its first person, so
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

test('the admin\'s screen: the reads, an export, and a step-up said yes and no to in her own chat', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-admin-'));
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
    await page.locator('[data-screen="connect"]').click();
    const code = await page.locator('[data-code]').getAttribute('data-code', { timeout: 30_000 });
    expect(await until(async () => ((await said()).some((x) => /koppelen|connect/i.test(x)) ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
    await send(`/koppelen ${code}`);
    await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 30_000 });

    // ── the admin's section; what a screen never gets is not on it ──
    const adminSection = page.locator('section[data-section="admin"]');
    await expect(adminSection).toBeVisible();
    for (const never of ['assistant.assistant-apps', 'assistant.assistant-import', 'assistant.assistant-screen-approve', 'assistant.assistant-screen']) {
      await expect(page.locator(`[data-op="${never}"]`)).toHaveCount(0);
    }
    const resultOf = (skill) => page.locator('.screen-op', { has: page.locator(`[data-op="${skill}"]`) }).locator('.screen-result');
    const run = async (skill) => { await page.locator(`[data-op="${skill}"]`).click(); await expect(resultOf(skill)).not.toHaveText(/^(…)?$/, { timeout: 30_000 }); return resultOf(skill).textContent(); };

    // ── the reads ──
    const status = await run('assistant.assistant-status');
    const users = await run('assistant.assistant-users');
    expect(users).toMatch(/admin/);
    const settings = await run('assistant.assistant-settings');
    expect(settings).toMatch(/Instellingen|Namen/);
    // ── an export now, then the shelf ──
    const exported = await run('assistant.assistant-export');
    const exports = await run('assistant.assistant-exports');
    testInfo.annotations.push({ type: 'answers', description: JSON.stringify({ status, users, settings, exported, exports }) });

    // ── a step-up said yes to: held, asked in her chat with the request's id, the screen told "Gedaan." ──
    const asked = (await said()).length;
    const held = await run('assistant.assistant-rotate');
    expect(held).toMatch(/eigen chat/);
    const question = await until(async () => (await said()).slice(asked).find((x) => /Scherm/.test(x)) ?? null, { timeout: 30_000, step: 500 });
    expect(question, `no question in her chat:\n${out.slice(-1200)}`).toBeTruthy();
    const id = /\/bevestig ja ([A-Z2-9]{4})/.exec(question)?.[1];
    expect(id).toBeTruthy();
    await send(`/bevestig ja ${id}`);
    await expect(resultOf('assistant.assistant-rotate')).toHaveText('Gedaan.', { timeout: 30_000 });

    // ── a step-up said no to: the screen told so ──
    const asked2 = (await said()).length;
    await run('assistant.assistant-invite');
    const q2 = await until(async () => (await said()).slice(asked2).find((x) => /Scherm/.test(x)) ?? null, { timeout: 30_000, step: 500 });
    const id2 = /\/bevestig nee ([A-Z2-9]{4})/.exec(q2 ?? '')?.[1];
    expect(id2).toBeTruthy();
    await send(`/bevestig nee ${id2}`);
    await expect(resultOf('assistant.assistant-invite')).toHaveText(/je zei nee/, { timeout: 30_000 });

    await page.screenshot({ path: testInfo.outputPath('admin-screen.png'), fullPage: true });
    testInfo.annotations.push({ type: 'dialogs', description: JSON.stringify(dialogs) });
    await ctx.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann).catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
