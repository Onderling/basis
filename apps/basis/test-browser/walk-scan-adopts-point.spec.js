/**
 * A DEVICE WITH NO RELAY ADOPTS THE POINT A SCANNED CARD BRINGS: REACHABLE RIGHT AFTER, AND AFTER A RESTART.
 *
 * B runs on the relay server (a relay of its own). A runs on the NO-relay server: no relay setting, no build argument,
 * no circle point. A opens B's contact card and adds it. Before, A dialled B's relay only at its first send, said
 * nothing and saved nothing, so after a reload it was on no relay again. Now, at the add, A saves B's point as its own,
 * dials it and says so once; B's answer reaches A; and after a reload A is still on that relay.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-scan-adopts-point.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, log, gotoCircles, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';
import { nameMe, whoAmI } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
const NO_RELAY_BASE = `http://localhost:${Number(process.env.PEER_TEST_PORT || '5173') + 1}`;

const relaysOf = (page) => page.evaluate(() => window.onderlingRelays?.() ?? []);

test('a no-relay device adopts the scanned card\'s point and stays reachable after a reload', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    B = await bootPeer(browser, 'B');
    // A: the no-relay server, nothing seeded
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[A pageerror] ${e.message.split('\n')[0]}`));
    await page.goto(`${NO_RELAY_BASE}/`); await page.waitForTimeout(4000);
    A = { context: ctx, page, label: 'A' };
    expect((await relaysOf(A.page)).length, 'A starts on no relay').toBe(0);
    await nameMe(A.page, 'Anna'); await nameMe(B.page, 'Bea');
    const aId = await whoAmI(A.page); const bId = await whoAmI(B.page);

    // A opens B's card the way a person does (the shared link), and adds it
    await B.page.locator('[data-tab="mij"]').first().click(); await B.page.waitForTimeout(1200);
    await B.page.locator('.cc-profile__share-contact').click();
    const link = await B.page.locator('.cc-share__link input').inputValue();
    await gotoCircles(B.page);
    const said = [];
    A.page.on('dialog', (d) => { said.push(d.message()); d.accept().catch(() => {}); });
    await A.page.goto('about:blank'); await A.page.goto(`${NO_RELAY_BASE}/${link.slice(link.indexOf('#'))}`);
    await expect(A.page.locator('[data-testid="contact-add-sheet"]'), 'A is asked first').toBeVisible({ timeout: 30_000 });
    await A.page.locator('.cc-lens__ok').click();

    await expect.poll(async () => (await relaysOf(A.page)).some((r) => r.url === R1 && r.connected), { timeout: 30_000, message: 'A is on B\'s relay right after the add' }).toBe(true);
    await expect.poll(() => said.join(' | '), { timeout: 10_000, message: 'A is told once whose point it uses' }).toMatch(/Bea/);
    log('STEP1 A adopted B\'s point at the add, and said so', 'PASS', said.join(' | '));

    // reachable: A writes, B answers, the answer lands at A
    const hi = `hoi ${Date.now().toString(36)}`;
    const sent = await sendDirectMessage(A.page, hi, { to: bId });
    expect(sent.sent, `A could not write: ${sent.why}`).toBe(true);
    // B never chose A: A's first message is a MESSAGE REQUEST on B's side (since 2026-11-12), and B accepts it; this walk
    // is about the relay point A adopts, not about that door
    await expect.poll(async () => ((await B.page.evaluate(async () => (await window.onderlingCall('pinboard', 'listMessageRequests', {}))?.requests ?? [])) ?? []).map((q) => q.from),
      { timeout: 30_000, message: 'A\'s first message is a request on B\'s side' }).toContain(aId);
    const accepted = await B.page.evaluate(async (from) => window.onderlingAcceptRequest(from), aId);
    expect(accepted?.accepted, JSON.stringify(accepted)).toBe(true);
    await waitForContactMessageDetailed(B.page, hi);
    const back = `terug ${Date.now().toString(36)}`;
    const answered = await sendDirectMessage(B.page, back, { to: aId });
    expect(answered.sent, `B could not answer: ${answered.why}`).toBe(true);
    await waitForContactMessageDetailed(A.page, back);
    log('STEP2 B\'s answer reached A', 'PASS');

    // after a restart A is still on that relay (the adopted point drives the boot choice)
    await A.page.reload(); await A.page.waitForTimeout(4000);
    await expect.poll(async () => (await relaysOf(A.page)).some((r) => r.url === R1 && r.connected), { timeout: 30_000, message: 'A is back on B\'s relay after a reload' }).toBe(true);
    log('STEP3 after a reload A is on the adopted relay', 'PASS');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
