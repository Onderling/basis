/**
 * STEP 0, WALKED AS FRITS WILL WALK IT — headless, on real processes, nothing on anyone's devices.
 *
 * Follows the step-0 walk (your companion beside the bot, paired from your phone) word for word, composed as the box
 * composes it:
 *   - the relay: a local @onderling/relay process, serving the links (`/feed`), as the public relay does;
 *   - the box: the REAL role files (deploy/roles/assistant.yml + companion.yml), the same images release.sh builds,
 *     started by `docker compose` with the relay as their argument — the companion UNCLAIMED, its claim line read from
 *     the compose log the way a person reads it (`logs … | grep 'Claim:' | tail -1`). The walk's only additions are in
 *     fixtures/step0-walk.compose.yml (host networking, so every party names the relay the same way; a fake Bot API);
 *   - the person: the real WEB app in Chromium, a fresh identity;
 *   - Telegram: a Bot API of our own (the person's private chat).
 * Each step asserts the walk's own Expect.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-step0-box.spec.js
 */
import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fakeBotApi } from '../test/support/fakeBotApi.js';
import { startJourneyRelay } from '../test/support/testRelay.js';
import { until } from '../test/support/pairRealAgents.js';

const R1 = process.env.PEER_TEST_RELAY || '';
const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const OVERRIDE = fileURLToPath(new URL('./fixtures/step0-walk.compose.yml', import.meta.url));
const PROJECT = `step0walk${process.pid}`;
const ADMIN = '9';
const hasDocker = (() => { try { execFileSync('docker', ['info'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test.skip(!R1 || !hasDocker, 'needs PEER_TEST_RELAY and docker');

/** `docker compose` for this walk's project, over the box's role files + the walk's override. */
function compose(args, env, { stdio = 'pipe' } = {}) {
  return execFileSync('docker', ['compose', '-p', PROJECT,
    '-f', path.join(ROOT, 'deploy/roles/assistant.yml'), '-f', path.join(ROOT, 'deploy/roles/companion.yml'), '-f', OVERRIDE,
    ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', stdio, maxBuffer: 64 * 1024 * 1024 });
}
const logsOf = (svc, env) => { try { return compose(['logs', '--no-color', svc], env); } catch (e) { return String(e?.stdout ?? ''); } };

test('step 0: link, claim the companion, give the bot the agenda files, the link, revoke', async ({ browser }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const appUrl = `${testInfo.project.use.baseURL}/`;
  const cleanup = [];
  const relay = await startJourneyRelay({ feeds: { missFloorMs: 0 } });
  cleanup.push(() => relay.close());
  const base = relay.url.replace(/^ws/, 'http');
  const api = await fakeBotApi();
  cleanup.push(api.close);
  const env = {
    COMPANION_RELAY_URL: relay.url, COMPANION_PUBLIC_URL: base,
    TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0',
    BASIS_APP_URL: appUrl.replace(/\/$/, ''), STEP0_TELEGRAM_API_ROOT: api.root, TZ: 'Europe/Amsterdam',
  };
  const said = (uid = ADMIN) => api.said(uid).map((m) => m.text);
  async function ask(text, test = () => true, uid = ADMIN) {
    const before = api.said(uid).length;
    api.write(uid, text, 'Frits');
    const got = await until(async () => api.said(uid).slice(before).find((m) => test(m)) ?? null, { timeout: 90_000, step: 250 });
    expect(got, `no answer to "${text}" (said: ${JSON.stringify(said(uid).slice(before))})\n${logsOf('assistant', env).slice(-2000)}`).toBeTruthy();
    let n = -1;
    while (n !== api.said(uid).length) { n = api.said(uid).length; await new Promise((r) => { setTimeout(r, 800); }); }
    return { ...got, all: said(uid).slice(before).join('\n') };
  }
  const fetchFeed = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }; };

  try {
    // ── Before: the box's two roles, built and started from the real role files ──
    compose(['build'], env, { stdio: 'inherit' });
    compose(['up', '-d'], env);
    cleanup.push(() => compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], env));   // the walk's images too: each run builds its own
    const boxAddress = (await until(async () => /address\s+(\S{20,})/.exec(logsOf('assistant', env))?.[1] ?? null, { timeout: 240_000, step: 1000 }));
    expect(boxAddress, `the box never came up:\n${logsOf('assistant', env).slice(-2000)}`).toBeTruthy();
    const companionAddress = await until(async () => /Host agent:\s+(\S+)/.exec(logsOf('companion', env))?.[1] ?? null, { timeout: 240_000, step: 1000 });
    expect(companionAddress, `the companion never came up:\n${logsOf('companion', env).slice(-2000)}`).toBeTruthy();

    // the person's app: a fresh identity on this walk's relay
    const ctx = await browser.newContext({ locale: 'nl-NL' });
    await ctx.addInitScript((url) => { try { localStorage.setItem('cc.relayUrl', url); } catch { /* */ } }, relay.url);
    const page = await ctx.newPage();
    cleanup.push(() => ctx.close());
    await page.goto(appUrl);
    await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 120_000 }).toBe(true);

    // ── 1 · Link again: /koppel → open the link → "Maak de koppelregel" → paste the line → pick the code ──
    await ask('/start');
    const start = await ask('/koppel', (m) => /#koppel-bot=/.test(m.text));
    const startLink = start.all.match(/\S+#koppel-bot=[A-Za-z0-9_-]+/)?.[0];
    expect(startLink, start.all).toBeTruthy();
    expect(startLink.startsWith(appUrl.replace(/\/$/, '')), 'the link opens the app the box names').toBe(true);
    await page.goto(startLink);
    const sheet = page.locator('[data-identity-link="sheet"]');
    await expect(sheet).toBeVisible({ timeout: 120_000 });
    await sheet.locator('[data-identity-link="make"]').click();
    const line = await sheet.locator('[data-identity-link="line"]').inputValue({ timeout: 30_000 });
    const code = (await sheet.locator('[data-identity-link="code"]').innerText()).trim();
    const question = await ask(line, (m) => Boolean(m.reply_markup) || /code/i.test(m.text));
    const buttons = (question.reply_markup?.inline_keyboard ?? []).flat();
    // "pick the code your app shows": the bot offers the codes as buttons; tap the one the app shows
    const mine = buttons.find((b) => String(b.text).includes(code));
    expect(mine?.callback_data, `the bot offers the app's code as a button (offered: ${JSON.stringify(buttons.map((b) => b.text))})`).toBeTruthy();
    const beforeTap = api.said(ADMIN).length;
    api.tap(ADMIN, mine.callback_data, 'Frits');
    await until(async () => (said().slice(beforeTap).some((s) => /[Gg]ekoppeld/.test(s)) ? true : null), { timeout: 60_000, step: 250 });
    // Expect: the bot says you are linked; in the app the bot is now a contact
    expect(said().join('\n'), 'the bot says you are linked').toMatch(/[Gg]ekoppeld/);
    await expect(sheet.locator('[data-identity-link="linked"]')).toBeVisible({ timeout: 60_000 });
    const contact = await until(async () => ((await page.evaluate(() => window.onderlingCall('stoop', 'listContacts', {})))?.contacts ?? [])
      .find((c) => c.webid === boxAddress && c.linkedRow) ?? null, { timeout: 60_000, step: 500 });
    expect(contact, 'the bot is a contact in the app').toMatchObject({ webid: boxAddress, linkedRow: `telegram:${ADMIN}` });

    // ── 2 · Claim the companion: the claim line from the log, pasted under My data → "Companion claimen" ──
    const claimLine = /Claim:\s+(\S+@\S+)/g;
    let claim = null;
    for (const m of logsOf('companion', env).matchAll(claimLine)) claim = m[1];   // `| tail -1`
    expect(claim, 'the companion prints a claim line').toBeTruthy();
    await page.goto(appUrl);
    await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 120_000 }).toBe(true);
    await page.locator('[data-tab="mij"]').first().click();
    await page.locator('.cc-profile__mydata').first().click();
    await page.locator('.cc-mydata__claim-companion').first().click();
    // the claim sheet: its field (placeholder 'ABCD-EFGH@…') and its 'Claimen' button
    await page.getByPlaceholder('ABCD-EFGH@…').fill(claim);
    await page.getByRole('button', { name: 'Claimen', exact: true }).click();
    // Expect: "Deze companion is nu van jou."
    await expect(page.getByText('Deze companion is nu van jou', { exact: false })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Sluiten', exact: true }).click();

    // ── 3 · Mijn agents → at the companion: "Toegang geven" → pick the bot → tick "agenda-bestanden plaatsen" ──
    const row = page.locator('.cc-mydata__companion').first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.locator('.cc-mydata__companion-give').click();
    const to = row.locator('.cc-mydata__companion-to');
    await expect(to).toBeVisible({ timeout: 60_000 });
    await to.selectOption(boxAddress);
    const family = row.locator('.cc-mydata__companion-family');
    await expect(family).toHaveCount(1);
    await expect(row.locator('.cc-mydata__companion-panel')).toContainText('agenda-bestanden plaatsen');
    await family.check();
    await row.locator('.cc-mydata__companion-confirm').click();
    // Expect: under the companion: "<de bot> — mag: agenda-bestanden plaatsen · intrekken"
    const holder = row.locator('.cc-mydata__companion-holder');
    await expect(holder).toHaveCount(1, { timeout: 60_000 });
    await expect(holder).toContainText('mag: agenda-bestanden plaatsen');
    await expect(holder.locator('.cc-mydata__companion-revoke')).toHaveText('intrekken');

    // ── 4 · The link: /huishouden agenda on, then /agenda-link; open it ──
    await ask('tandarts morgen om 10 uur', (m) => /tandarts/i.test(m.text));   // the walk's "your appointments"
    expect((await ask('/huishouden agenda on')).all).not.toMatch(/niet opgeslagen/);
    const got = await ask('/agenda-link', (m) => /\/feed\//.test(m.text));
    const link = got.all.match(/http:\/\/127\.0\.0\.1:\d+\/feed\/[A-Za-z0-9_-]{43}\/\S+\.ics/)?.[0];
    expect(link, got.all).toBeTruthy();
    expect(link, 'served at the relay, naming the companion').toContain(`${base}/feed/${companionAddress}/`);
    // Expect: your appointments
    const first = await fetchFeed(link);
    expect(first.status, `${first.body}\n${logsOf('companion', env).slice(-800)}`).toBe(200);
    expect(first.type).toMatch(/^text\/calendar/);
    expect(first.body).toMatch(/SUMMARY:[^\r\n]*[Tt]andarts/);
    // Expect: add one in Telegram and the calendar shows it after its next refresh
    await ask('kapper overmorgen om 11 uur', (m) => /kapper/i.test(m.text));
    expect(await until(async () => (/[Kk]apper/.test((await fetchFeed(link)).body) ? true : null), { timeout: 30_000, step: 500 }), 'the calendar follows').toBe(true);

    // ── 5 · Revoke: "intrekken" under the bot ──
    const before = api.said(ADMIN).length;
    await holder.locator('.cc-mydata__companion-revoke').click();
    // Expect: the link answers "not found"
    expect(await until(async () => ((await fetchFeed(link)).status === 404 ? true : null), { timeout: 30_000, step: 500 }), 'the link is dark').toBe(true);
    // Expect: the bot tells you once that the links are off (on its next change)
    const ENDED = /geeft me geen toegang meer/;
    await ask('zwemmen overmorgen om 15 uur', (m) => /zwemmen/i.test(m.text));
    expect(await until(async () => (said().slice(before).some((s) => ENDED.test(s)) ? true : null), { timeout: 60_000, step: 500 }), `the bot says so\n${said().slice(before).join('\n')}`).toBe(true);
    await ask('tennis overmorgen om 17 uur', (m) => /tennis/i.test(m.text));
    await new Promise((r) => { setTimeout(r, 6_000); });
    expect(said().slice(before).filter((s) => ENDED.test(s)), 'said once').toHaveLength(1);
  } finally {
    for (const f of cleanup.reverse()) { try { await f(); } catch { /* teardown is best-effort */ } }
  }
});
