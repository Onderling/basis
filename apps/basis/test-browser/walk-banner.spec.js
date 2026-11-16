/**
 * The in-app banner and the removal row, two real apps over the relay.
 *   1. B writes to A directly while A is on Today: a banner says so; tapping it opens the thread.
 *   2. While A is IN that thread, B's next message rings nothing (A is looking at it).
 *   3. A removes B from the circle: B gets a banner and a row on Today, though B is no longer in the circle.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-banner.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, gotoCircles, sendDirectMessage } from './peerHarness.js';

test.setTimeout(300_000);
const RE = /banner.?kring/i;
const call = (page, app, opId, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const surface = (page) => page.evaluate(() => window.onderlingSurface?.([]));

async function banner(page) {
  const el = page.locator('.cc-banner:not([hidden])');
  return (await el.count()) ? (await el.first().textContent()).replace(/\s+/g, ' ').trim() : null;
}
async function toToday(page) {
  if (!(await page.locator('[data-tab="screens"]').count())) await gotoCircles(page);
  await page.locator('[data-tab="screens"]').first().click();
}
async function forYouKinds(page) {
  await toToday(page);
  await page.waitForTimeout(1200);
  return page.locator('.circle-screen__block[data-block-type="forYou"] .circle-screen__for-you-row').evaluateAll((els) => els.map((e) => e.dataset.kind));
}

test('a direct message rings on Today, not in its own thread; a removal reaches the removed', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const p = await pair(A, B, { name: 'Banner Kring', re: RE });
    expect(p.joined, 'B joined A\'s circle').toBe(true);
    const gid = (await surface(A.page))?.where?.circleId ?? null;
    expect(gid, 'A is in the circle it made').toBeTruthy();

    // 1 · on Today, a direct message rings
    await toToday(A.page);
    const first = await sendDirectMessage(B.page, 'eerste bericht');
    expect(first.sent, JSON.stringify(first)).toBe(true);
    await expect.poll(() => banner(A.page), { timeout: 60_000, message: 'a banner for the direct message' }).toMatch(/eerste bericht/);
    await A.page.screenshot({ path: 'test-results/banner-dm.png' });
    await A.page.locator('.cc-banner').click();
    await expect.poll(() => A.page.locator('.cc-cthread').count(), { timeout: 15_000, message: 'the tap opened the thread' }).toBeGreaterThan(0);

    // 2 · in that thread, the next one does not ring
    const second = await sendDirectMessage(B.page, 'tweede bericht');
    expect(second.sent, JSON.stringify(second)).toBe(true);
    await A.page.waitForTimeout(15_000);
    expect(await banner(A.page), 'no banner on the source').toBe(null);

    // 3 · A removes B: B hears it (banner + row), though the circle has left B's list
    await toToday(B.page);
    const bId = (await call(B.page, 'pinboard', 'whoAmI', {}))?.webid ?? null;
    const removal = await call(A.page, 'pinboard', 'removeMember', { groupId: gid, memberWebid: bId, reason: 'walk' });
    expect(removal?.ok, JSON.stringify(removal)).not.toBe(false);
    await expect.poll(() => forYouKinds(B.page), { timeout: 90_000, message: 'B has a removal row on Today' }).toContain('removed');
    await B.page.screenshot({ path: 'test-results/banner-removed.png' });
  } finally {
    await teardown(peers);
  }
});
