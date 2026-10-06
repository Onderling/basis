/**
 * THE HOUSEHOLD IN YOUR OWN APP, IN A REAL BROWSER — the real box runner as a household bot; Ann (its first person, so
 * its admin, a headless node) puts melk on Boodschappen, turns the setting on and makes Bert a code. Bert is the WEB
 * APP in Chromium: it adds the bot by its card, comes in on the code through the bot's inbox, says `/inapp ja`, and
 * taps the link the bot sends — the app opens with the invite (`?join=`) and runs its own join.
 *
 * What it proves: the joined app holds the household's EXISTING lines — melk, put there before Bert ever joined — in its
 * own store for the household's circle, without a reload (the content lanes are pulled at the join); a later line
 * reaches it; and after `/revoke` a line the household adds no longer does (the eviction's consequence, not only the call).
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/household-in-app-box.spec.js
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

test('a joined app holds the household\'s existing lines, without a reload', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-household-app-'));
  let out = '';
  const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
    env: { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: R1, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0', BASIS_APP_URL: appUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => { out += String(b); });
  child.stderr.on('data', (b) => { out += String(b); });
  let ann = null;
  try {
    expect(await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 300 }), `the bot never came up:\n${out.slice(-1500)}`).toBe(true);
    const cardLink = /onderling-contact:\/\/[A-Za-z0-9_-]+/.exec(out)[0];
    const card = decodeContactCard(cardLink.replace('onderling-contact://', ''));
    ann = await bootRealAgentNode('ann', { contactChannel: true });
    await connectNodesOverRelay([ann], { relayUrl: R1 });
    const annSaid = async () => (await ann.contactThreadChannel.rehydrateAll()).filter((x) => x.origin === 'bot').map((x) => x.text);
    const annAsk = async (text, extra = {}) => {
      const from = (await annSaid()).length;
      await ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
      return until(async () => (await annSaid()).slice(from).join('\n') || null, { timeout: 30_000, step: 400 });
    };
    await annAsk('hallo', { admission: /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)[1] });
    expect(await annAsk('zet melk op de boodschappen')).toContain('melk');
    expect(await annAsk('/huishouden app on')).toBeTruthy();
    await annAsk('/cohort 3 7');
    const code = /\/start (\S+)/.exec(await annAsk('/invite'))[1];

    // ── Bert: the web app ──
    const ctx = await browser.newContext({ locale: 'nl-NL' });
    const page = await ctx.newPage();
    await page.goto(appUrl);
    await expect.poll(() => page.evaluate(() => typeof window.onderlingContactChannel?.sendTurn === 'function'), { timeout: 120_000 }).toBe(true);
    const added = await page.evaluate((payload) => window.onderlingCall('stoop', 'addContactFromQr', { payload }), cardLink);
    expect(added?.error, JSON.stringify(added)).toBeFalsy();
    const bertAsk = async (text, extra = {}) => page.evaluate(async ({ text, extra, bot }) => {
      const ch = window.onderlingContactChannel;
      const said = async () => (await ch.rehydrateAll()).filter((x) => x.origin === 'bot').map((x) => x.text);
      const from = (await said()).length;
      await ch.sendTurn({ peerAddr: bot, threadId: bot, text, ...extra }).sent;
      for (let i = 0; i < 75; i += 1) {
        const got = (await said()).slice(from);
        if (got.length) { await new Promise((r) => setTimeout(r, 1200)); return (await said()).slice(from).join('\n'); }
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    }, { text, extra, bot: card.peerAddr });
    expect(await bertAsk('hallo', { admission: code }), `Bert not admitted:\n${out.slice(-1200)}`).toBeTruthy();
    const yes = await bertAsk('/inapp ja');
    const invite = /onderling-invite:\/\/\S+/.exec(yes ?? '')?.[0];
    expect(invite, `no invite; the bot said: ${yes}`).toBeTruthy();

    // ── the join: Bert taps the link the bot sent — the app opens with the invite and runs its own join ──
    const link = /https?:\/\/\S+\?join=\S+/.exec(yes ?? '')?.[0];
    expect(link, `no link in: ${yes}`).toBeTruthy();
    await page.goto(link);
    const wizard = page.locator('.cc-mydata-modal__card');
    // This machine's local dev server sometimes serves a blank first load (ERR_NETWORK_CHANGED on every module — the
    // host's network flapping, not the app): one reload, the link still in the address bar, so the join still runs.
    const opened = await wizard.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
    if (!opened) await page.reload();
    await expect(wizard, 'the app opened its join screen from the link').toBeVisible({ timeout: 120_000 });
    for (let step = 0; step < 2; step += 1) {
      const tick = wizard.locator('.cc-wizard-check input[type="checkbox"]').first();
      if (await tick.count()) await tick.check().catch(() => {});
      await wizard.locator('.cc-wizard-btn-primary').first().click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    const handleInput = wizard.locator('.cc-wizard-handle-input');
    if (await handleInput.count()) await handleInput.fill('bert');
    await wizard.locator('.cc-wizard-submit').first().click();
    await expect(page.locator('.cc-mydata-modal__card'), 'the join completed (the wizard closed)').toHaveCount(0, { timeout: 90_000 });

    // ── the existing line is in the app's own store for the household's circle — no reload ──
    const circleId = JSON.parse(Buffer.from(invite.replace('onderling-invite://', ''), 'base64url').toString('utf8')).groupId;
    expect(circleId).toMatch(/^household:[0-9a-f]{16}$/);
    await expect.poll(async () => page.evaluate(async (cid) => {
      const r = await window.onderlingCall('lists', 'listEntries', { circleId: cid, list: 'Boodschappen' });
      return (r?.items ?? []).map((i) => i.label ?? i.text);
    }, circleId), { timeout: 60_000, message: 'melk reached the joined app' }).toContain('melk');

    // ── /revoke: the eviction's CONSEQUENCE — a line the household adds later no longer reaches Bert's app ──
    const bertHas = (text) => page.evaluate(async ({ cid, text }) => {
      const r = await window.onderlingCall('lists', 'listEntries', { circleId: cid, list: 'Boodschappen' });
      return (r?.items ?? []).some((i) => (i.label ?? i.text) === text);
    }, { cid: circleId, text });
    // the control: before the revoke, a later line does reach him (the path works)
    expect(await annAsk('zet kaas op de boodschappen')).toContain('kaas');
    await expect.poll(() => bertHas('kaas'), { timeout: 60_000, message: 'a later line reached the joined app' }).toBe(true);
    const users = await annAsk('/users');
    const bert = users.split('\n').find((l) => !/beheerder|admin/i.test(l))?.split(' — ')[0]?.trim();
    expect(bert, `no member in /users:\n${users}`).toBeTruthy();
    expect(await annAsk(`/revoke ${bert}`)).toMatch(/huishouden in de app|household in the app/i);
    expect(await annAsk('zet brood op de boodschappen')).toContain('brood');
    // the bot holds it; the revoked app does not, however long it waits
    await page.waitForTimeout(20_000);
    expect(await bertHas('brood'), 'a line added after /revoke reached the revoked app').toBe(false);
    await ctx.close();
  } finally {
    await teardown(ann).catch?.(() => {});
    child.kill();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp */ }
  }
});
