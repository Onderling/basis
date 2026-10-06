/**
 * EVERY BUTTON ON THE MANAGEMENT SCREEN DOES SOMETHING (Frits 2026-10-05: "the buttons should be tested on their
 * effectivity"). The real box as a household bot, Ann (its admin) in its inbox, her screen in Chromium. Every op button
 * is pressed — a form filled per field (text, number, the first choice of a pick-list, the first of a choice) — and
 * every action on a list line and on a person; each must answer without an error. What waits for a yes in the private
 * chat (a role, removing a person, an invite) is named and skipped here (`screen-admin-box` walks the yes).
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/screen-buttons-box.spec.js
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
/** What waits for a yes in the private chat, or asks a secret, or leaves the screen: walked elsewhere. */
const SKIP = /assistant-(role|revoke|invite|cohort|rotate|import|export-key-set|export-key-unlock|screen|screens|screen-paste|screen-confirm|link|link-confirm|unlink|circle|apps)$/;
/** A plausible value per field: a time where a time is asked, words elsewhere. */
const tomorrowAt10 = () => { const d = new Date(Date.now() + 86_400_000); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`; };
const fillFor = (name) => (/when|start|time|date/i.test(String(name)) ? 'morgen 10:00' : 'walk test');
const BAD = /lukte niet|niet gelukt|mislukt|refused|revoked|did not respond|Timeout|unknown|onbekend|niet herkend|Error|Even rustig/i;

test('every button on the admin\'s management screen answers without an error', async ({ browser }, testInfo) => {
  test.setTimeout(900_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-buttons-'));
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
    await send('hallo', { admission: /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)[1] });
    expect(await until(async () => ((await said()).length ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
    // something on the lists and the chores, so the line actions have lines
    // a line for every line action (each action gets a line of its own: ticking one off takes it away)
    // (plain lines: done · remove · edit · make-a-chore — four)
    const LINES = { Boodschappen: ['melk', 'kaas', 'brood', 'eieren'], Klusjes: ['afwassen', 'stofzuigen', 'ramen', 'planten'] };
    for (const [list, texts] of Object.entries(LINES)) for (const text of texts) await send(`/add-to-list --list ${list} --text ${text}`);
    expect(await until(async () => ((await said()).filter((x) => /planten/.test(x)).length ? true : null), { timeout: 40_000, step: 500 }), `the lines were not added:\n${(await said()).slice(-3).join('\n')}`).toBe(true);
    await send('/scherm link');
    const linkLine = await until(async () => (await said()).find((x) => x.includes('#scherm=')) ?? null, { timeout: 30_000, step: 500 });

    const ctx = await browser.newContext({ locale: 'nl-NL' });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(/https?:\/\/\S+/.exec(linkLine)[0]);
    await expect(page.locator('[data-screen="connect"]')).toBeVisible({ timeout: 60_000 });
    const before = (await said()).length;
    await page.locator('[data-screen="connect"]').click();
    const code = await page.locator('[data-code]').getAttribute('data-code', { timeout: 30_000 });
    expect(await until(async () => ((await said()).slice(before).some((x) => /koppelen|connect/i.test(x)) ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
    await send(`/koppelen ${code}`);
    await expect(page.locator('[data-screen="connected"]')).toBeVisible({ timeout: 30_000 });

    const pace = () => page.waitForTimeout(Number(process.env.BUTTONS_PACE_MS ?? 1_000));   // inside the screen's call budget
    const results = [];
    const skipped = [];

    // ── every action on a list line and on a person ──
    const household = page.locator('section[data-section="household"]');
    await expect(household.locator('[data-line] [data-action]').first()).toBeVisible({ timeout: 40_000 });   // painted after connecting
    // one line per action: each action is pressed on a line no earlier action touched
    const rowActions = await household.locator('[data-action]').evaluateAll((els) => els.map((e) => ({ skill: e.getAttribute('data-action'), row: (e.closest('[data-line]') ?? e.closest('[data-person]'))?.getAttribute(e.closest('[data-line]') ? 'data-line' : 'data-person') })));
    expect(rowActions.length, 'the household section has line actions to press').toBeGreaterThan(0);
    const used = new Set();
    for (const skill of [...new Set(rowActions.map((r) => r.skill))]) {
      if (SKIP.test(skill)) { skipped.push(`${skill} (row)`); continue; }
      const pick = rowActions.find((r) => r.skill === skill && !used.has(r.row));
      if (!pick) { results.push({ skill: `${skill} on a row`, answer: '(no line left for it)' }); continue; }
      used.add(pick.row);
      await pace();
      const scope = household.locator(`[data-line="${pick.row}"], [data-person="${pick.row}"]`).first();
      await scope.locator(`[data-action="${skill}"]`).click();
      const form = scope.locator('form').first();
      if (await form.count()) {
        for (const input of await form.locator('input[required]:not([readonly])[type="text"], input[required]:not([readonly]):not([type]), textarea[required]:not([readonly])').all()) await input.fill(fillFor(await input.getAttribute('name')));
        const choice = form.locator('.cc-picker-row').first();
        await form.locator('.cc-picker-list:not(.cc-picker-loading)').first().waitFor({ timeout: 15_000 }).catch(() => {});
        if (await choice.count()) await choice.click();
        else if (await form.locator('button[type="submit"]').count()) await form.locator('button[type="submit"]').click();
      }
      const saidRow = page.locator('[data-household="said"]');
      await expect(saidRow).not.toHaveText(/^(…)?$/, { timeout: 40_000 }).catch(() => {});
      results.push({ skill: `${skill} on a row`, answer: ((await saidRow.textContent()) ?? '').trim() || '(nothing)' });
    }

    // ── every op button: pressed, its form filled, its answer read ──
    const ops = await page.locator('.screen-op > button[data-op]').evaluateAll((els) => els.map((e) => e.getAttribute('data-op')));
    for (const skill of ops) {
      if (SKIP.test(skill)) { skipped.push(skill); continue; }
      await pace();
      const op = page.locator('.screen-op', { has: page.locator(`> button[data-op="${skill}"]`) }).first();
      const result = op.locator('.screen-result').first();
      const was = (await result.textContent()) ?? '';
      await op.locator(`> button[data-op="${skill}"]`).click();
      const form = op.locator('form').first();
      if (await form.count()) {
        // only what the form REQUIRES (an optional field left empty is what a person does first)
        for (const input of await form.locator('input[required]:not([readonly])[type="text"], input[required]:not([readonly]):not([type]), textarea[required]:not([readonly])').all()) await input.fill(fillFor(await input.getAttribute('name')));
        for (const input of await form.locator('input[required][type="number"]').all()) await input.fill('1');
        for (const input of await form.locator('input[required][type="datetime-local"]').all()) await input.fill(tomorrowAt10());
        const pick = form.locator('.cc-picker-row').first();
        await form.locator('.cc-picker-list:not(.cc-picker-loading)').first().waitFor({ timeout: 15_000 }).catch(() => {});
        if (await pick.count()) await pick.click();
        else await form.locator('button[type="submit"]').click();
      }
      await expect(result).not.toHaveText(/^(…)?$/, { timeout: 40_000 }).catch(() => {});
      const now = ((await result.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      results.push({ skill, answer: now || (was ? '(unchanged)' : '(nothing)') });
      // a removed list comes back through the answer's own button
      if (skill === 'lists.restoreList' && await op.locator('[data-reply]').count()) {
        await pace();
        await op.locator('[data-reply]').first().click();
        await expect(result).toHaveText(/terug/i, { timeout: 40_000 }).catch(() => {});
        results.push({ skill: 'lists.restoreList (its button)', answer: ((await result.textContent()) ?? '').trim() });
      }
    }

    testInfo.annotations.push({ type: 'skipped (walked elsewhere)', description: skipped.join(', ') });
    console.log('BUTTONS-WALK', JSON.stringify({ results, skipped }, null, 1));
    const failed = results.filter((r) => BAD.test(r.answer) || r.answer === '(nothing)' || r.answer === '(no line left for it)');
    expect(failed, JSON.stringify(failed, null, 1)).toEqual([]);
    expect(results.length, 'buttons were pressed').toBeGreaterThan(10);
    await ctx.close();
  } finally {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann).catch(() => {});
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
