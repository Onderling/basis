/**
 * A MEMBER'S SCREEN, IN A REAL BROWSER — the real box runner as a household bot; Ann (its first person, so its admin)
 * invites Bert with a code; Bert, in the bot's inbox, asks `/scherm` and connects the web app in Chromium.
 *
 * What Bert would see: the household's lists, chores and agenda, and his own settings — no admin section, and none of
 * the ops that change who is in; what he adds from the screen is on the household's list, as him.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/screen-member-box.spec.js
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

test('a member\'s screen: the household\'s ops, no admin section, an add that lands as him', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-member-'));
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
  let ann = null; let bert = null;
  try {
    expect(await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 300 }), `the bot never came up:\n${out.slice(-1500)}`).toBe(true);
    const card = decodeContactCard(/onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(out)[1]);
    ann = await bootRealAgentNode('ann', { contactChannel: true });
    bert = await bootRealAgentNode('bert', { contactChannel: true });
    await connectNodesOverRelay([ann, bert], { relayUrl: R1 });
    const saidTo = (node) => async () => (await node.contactThreadChannel.rehydrateAll()).filter((x) => x.origin === 'bot').map((x) => x.text);
    const sendAs = (node) => (text, extra = {}) => node.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
    const annSaid = saidTo(ann); const annSend = sendAs(ann);
    const bertSaid = saidTo(bert); const bertSend = sendAs(bert);
    const next = async (said, from, re) => until(async () => (await said()).slice(from).find((x) => re.test(x)) ?? null, { timeout: 30_000, step: 500 });

    // Ann, the first, is the admin; she opens a cohort and makes Bert a code
    await annSend('hallo', { admission: /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)[1] });
    expect(await until(async () => ((await annSaid()).length ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
    let seen = (await annSaid()).length;
    await annSend('/cohort 3 7');
    expect(await next(annSaid, seen, /./), `no answer to /cohort:\n${out.slice(-1200)}`).toBeTruthy();
    seen = (await annSaid()).length;
    await annSend('/invite');
    const invite = await next(annSaid, seen, /\/start \S+/);
    expect(invite, `no invite code; Ann was told:\n${(await annSaid()).slice(-4).join('\n---\n')}`).toBeTruthy();
    const code = /\/start (\S+)/.exec(invite)[1];

    // Bert comes in on that code: a member
    await bertSend('hallo', { admission: code });
    expect(await until(async () => ((await bertSaid()).length ? true : null), { timeout: 30_000, step: 500 }), `Bert not admitted:\n${out.slice(-1200)}`).toBe(true);
    seen = (await bertSaid()).length;
    await bertSend('/scherm');   // a member gets the link
    const linkLine = await next(bertSaid, seen, /#scherm=/);
    expect(linkLine, `no link for Bert:\n${out.slice(-1200)}`).toBeTruthy();

    const ctx = await browser.newContext({ locale: 'nl-NL' });
    const page = await ctx.newPage();
    await page.goto(/https?:\/\/\S+/.exec(linkLine)[0]);
    // the first load of a fresh dev server is slow: wait for the page as the connect walk does
    await expect(page.locator('[data-screen="connect"]')).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-screen="connect"]').click();
    const screenCode = await page.locator('[data-code]').getAttribute('data-code', { timeout: 30_000 });
    expect(await next(bertSaid, seen, /koppelen|connect/i)).toBeTruthy();
    await bertSend(`/koppelen ${screenCode}`);
    await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 30_000 });

    // ── a member's screen: the household's sections, his own; no admin section, nothing that changes who is in ──
    await expect(page.locator('section[data-section="lists"]')).toBeVisible();
    await expect(page.locator('section[data-section="admin"]')).toHaveCount(0);
    for (const never of ['status', 'users', 'settings', 'export', 'exports', 'invite', 'cohort', 'role', 'revoke', 'rotate', 'apps', 'import']) {
      await expect(page.locator(`[data-op="assistant.assistant-${never}"]`)).toHaveCount(0);
    }
    for (const adminOp of ['tasks.removeTask', 'tasks.reassignTask']) {
      await expect(page.locator(`[data-op="${adminOp}"]`)).toHaveCount(0);
    }
    // making, removing and putting back a list are everyone's (Frits 2026-10-05)
    for (const op of ['lists.createList', 'lists.removeList', 'lists.restoreList']) await expect(page.locator(`[data-op="${op}"]`)).toHaveCount(1);

    // ── an add from his screen lands on the household's list, and Ann reads it ──
    const add = page.locator('[data-op="lists.addToList"]');
    await add.click();
    const form = page.locator('.screen-op', { has: add }).locator('form, .cc-form');
    // the list is PICKED from the lists this screen may read (not typed); picking it sends the form
    await form.locator('[name="text"]').first().fill('van-berts-scherm');
    await form.locator('.cc-picker-row', { hasText: 'Boodschappen' }).first().click({ timeout: 30_000 });
    await expect(page.locator('.screen-op', { has: add }).locator('.screen-result')).toContainText(/van-berts-scherm/, { timeout: 30_000 });
    seen = (await annSaid()).length;
    await annSend('/list-entries Boodschappen');
    const annReads = await next(annSaid, seen, /van-berts-scherm/);
    expect(annReads, `Ann does not see Bert's add:\n${(await annSaid()).slice(seen).join('\n')}`).toBeTruthy();

    // ── the household itself on his screen: the lists, his own add among them, read again after the add ──
    const household = page.locator('section[data-section="household"]');
    await expect(household.locator('[data-list="Boodschappen"]')).toContainText('van-berts-scherm', { timeout: 30_000 });
    await expect(household.locator('[data-list="Klusjes"]')).toBeVisible();

    // Ann puts a chore on Klusjes in her chat; Bert's screen shows it by itself, open, with "Ik doe het"; he takes it; then "Klaar"
    seen = (await annSaid()).length;
    await annSend('/add-to-list --list Klusjes --text ramen-lappen');
    expect(await next(annSaid, seen, /ramen-lappen/)).toBeTruthy();
    // no refresh: the bot's nudge brings it (it names nothing; the screen reads again as Bert)
    const chore = household.locator('[data-list="Klusjes"] li', { hasText: 'ramen-lappen' });
    await expect(chore).toBeVisible({ timeout: 30_000 });
    await chore.locator('[data-action="tasks.claimTask"]').click();
    await expect(chore.locator('[data-action="tasks.completeTask"]'), `after the claim the screen said: ${await household.locator('[data-household="said"]').textContent()}`).toBeVisible({ timeout: 30_000 });
    await chore.locator('[data-action="tasks.completeTask"]').click();
    await expect(household.locator('[data-list="Klusjes"] li:not(.done)', { hasText: 'ramen-lappen' })).toHaveCount(0, { timeout: 30_000 });

    await page.screenshot({ path: testInfo.outputPath('member-screen.png'), fullPage: true });
    await ctx.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann, bert).catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
