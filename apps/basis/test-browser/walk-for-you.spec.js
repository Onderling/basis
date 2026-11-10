/**
 * "Nieuw voor jou" on Today, two real apps over the relay. A makes a circle, B joins it (A admitted B: a row), B writes
 * in the circle (a row) and to A directly (a row). A sets one aside with ✕ (it stays gone after a reload), then
 * "Alles gelezen" empties the block, and the block is gone (never an empty block).
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-for-you.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, gotoCircles, openCircleMatching, toChat, sendChat, sendDirectMessage } from './peerHarness.js';

test.setTimeout(300_000);
const RE = /voor.?jou.?kring/i;

async function forYou(page) {
  if (!(await page.locator('[data-tab="screens"]').count())) await gotoCircles(page);
  await page.locator('[data-tab="screens"]').first().click();
  await page.waitForTimeout(1200);
  return page.locator('.circle-screen__block[data-block-type="forYou"] .circle-screen__for-you-row')
    .evaluateAll((els) => els.map((e) => `${e.dataset.kind}|${e.textContent.replace(/\s+/g, ' ').trim()}`));
}

test('what came in for me is on Today; set aside, it stays gone; all read, the block is gone', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const p = await pair(A, B, { name: 'Voor Jou Kring', re: RE });
    expect(p.joined, 'B joined A\'s circle').toBe(true);
    await gotoCircles(A.page);
    await expect.poll(() => forYou(A.page), { timeout: 60_000, message: 'A admitted B: a joined row' }).toContainEqual(expect.stringMatching(/^joined\|/));

    await gotoCircles(B.page);
    await openCircleMatching(B.page, RE);
    await toChat(B.page);
    await sendChat(B.page, 'een regel voor jou');
    await expect.poll(() => forYou(A.page), { timeout: 60_000, message: 'a line from B' }).toContainEqual(expect.stringMatching(/^line\|.*een regel voor jou/));

    const dm = await sendDirectMessage(B.page, 'een bericht voor jou');
    expect(dm.sent, JSON.stringify(dm)).toBe(true);
    await expect.poll(() => forYou(A.page), { timeout: 60_000, message: 'a direct message from B' }).toContainEqual(expect.stringMatching(/^dm\|.*een bericht voor jou/));

    await A.page.screenshot({ path: 'test-results/for-you-rows.png' });
    // set the line aside: gone, and still gone after a reload
    const lineRow = A.page.locator('.circle-screen__for-you-row[data-kind="line"]');
    await lineRow.locator('.circle-screen__for-you-dismiss').click();
    await expect.poll(() => forYou(A.page), { timeout: 15_000 }).not.toContainEqual(expect.stringMatching(/^line\|/));
    await A.page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => A.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => forYou(A.page), { timeout: 30_000, message: 'set aside stays aside after a reload' }).toContainEqual(expect.stringMatching(/^dm\|/));
    expect(await forYou(A.page)).not.toContainEqual(expect.stringMatching(/^line\|/));

    // all read: the block is gone
    await A.page.locator('.circle-screen__for-you-all').click();
    await expect.poll(() => A.page.locator('.circle-screen__block[data-block-type="forYou"]').count(), { timeout: 15_000, message: 'never an empty block' }).toBe(0);
    await A.page.screenshot({ path: 'test-results/for-you-after.png' });
  } finally {
    await teardown(peers);
  }
});
