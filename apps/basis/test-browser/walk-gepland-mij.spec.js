/**
 * MY OWN APPOINTMENTS ON VANDAAG, ON A REAL SCREEN (2026-10-07; Vandaag since 2026-10-15, when Mij's Gepland moved
 * there as the seeded week). A person adds two appointments of no circle and one in a circle; Vandaag's agenda opened
 * whole ("meer") is Gepland's twin — one time line, the circle's among my own (read on this device, no bot); after a
 * RELOAD my own is still there: a person's own appointments live in their own
 * store (sealed, in IndexedDB), not on the in-memory calendar that lost them at every restart.
 *
 *   PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-gepland-mij.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('my own appointment shows on Vandaag, and is still there after a reload', async ({ browser }) => {
  test.setTimeout(180_000);
  let A = null;
  try {
    A = await bootPeer(browser, 'A');
    await gotoCircles(A.page);
    const at = (days, h) => A.page.evaluate(([d, hh]) => { const x = new Date(Date.now() + d * 86_400_000); x.setHours(hh, 0, 0, 0); return x.toISOString(); }, [days, h]);
    const made = await A.page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'tandarts', when: w }), await at(1, 14));
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    expect((await A.page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'kapper', when: w }), await at(2, 9)))?.ok).toBe(true);
    // one in a circle, between my own two: Gepland's twin is ONE time line across the circles and my own
    const circleId = await A.page.evaluate(async () => { const r = await window.onderlingCall('stoop', 'listMyCircles', {}); const c = (r?.circles ?? [])[0]; return typeof c === 'string' ? c : (c?.groupId ?? c?.id ?? null); });
    expect(circleId, 'a fresh profile has a circle').toBeTruthy();
    const inCircle = await A.page.evaluate(async ([w, cid]) => window.onderlingCall('calendar', 'addEvent', { title: 'repetitie', when: w, circleId: cid }), [await at(1, 19), circleId]);
    expect(inCircle?.ok, JSON.stringify(inCircle)).toBe(true);
    const openVandaag = async () => { await A.page.locator('[data-tab="screens"]').first().click(); };
    await openVandaag();
    await expect(A.page.locator('.circle-screen__agenda-row').filter({ hasText: 'tandarts' }), 'Vandaag shows my own appointment').toBeVisible({ timeout: 20_000 });
    // "meer" on the agenda: the week whole, in time order, the circle's line among my own
    await A.page.locator('.circle-screen__block:has(.circle-screen__agenda-list) .circle-screen__more').first().click();
    await expect.poll(async () => (await A.page.locator('.circle-screen__agenda-row').allTextContents()).map((x) => (x.match(/tandarts|repetitie|kapper/) ?? [''])[0]).filter(Boolean),
      { timeout: 20_000, message: 'one chronological list across the circle and my own' }).toEqual(['tandarts', 'repetitie', 'kapper']);
    log('STEP1 Vandaag', 'PASS', 'my own appointments and a circle\'s, one time line when opened whole');

    // past the store's save delay (200 ms): a person does not reload within a fifth of a second of a change
    await A.page.waitForTimeout(1500);
    await A.page.reload();
    await gotoCircles(A.page);
    await openVandaag();
    await expect(A.page.locator('.circle-screen__agenda-row').filter({ hasText: 'tandarts' }), 'still there after a reload (the own store is durable)').toBeVisible({ timeout: 30_000 });
    log('STEP2 reload', 'PASS', 'the own store kept it');
  } finally {
    await teardown([A].filter(Boolean));
  }
});
