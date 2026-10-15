/**
 * MY OWN APPOINTMENT ON VANDAAG, ON A REAL SCREEN (2026-10-07; Vandaag since 2026-10-15, when Mij's Gepland moved
 * there as the seeded week). A person adds an appointment of no circle; Vandaag's week shows it (read on this device —
 * no bot); after a RELOAD it is still there: a person's own appointments live in their own
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
    const when = await A.page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(14, 0, 0, 0); return d.toISOString(); });
    const made = await A.page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'tandarts', when: w }), when);
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    const openVandaag = async () => { await A.page.locator('[data-tab="screens"]').first().click(); };
    await openVandaag();
    await expect(A.page.locator('.circle-screen__agenda-row').filter({ hasText: 'tandarts' }), 'Vandaag shows my own appointment').toBeVisible({ timeout: 20_000 });
    log('STEP1 Vandaag', 'PASS', 'my own appointment on Vandaag');

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
