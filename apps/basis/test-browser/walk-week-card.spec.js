/**
 * THE PERSON'S OWN WEEK OVERVIEW, ON A REAL SCREEN (2026-10-07). My data switches it on (a row in their own store,
 * still on after a reload); when their clock runs it, a card of their week shows at the top of the app, saying it shows
 * because the app is open.
 *
 *   PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-week-card.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('the week overview is switched on in My data, survives a reload, and its card shows', async ({ browser }) => {
  test.setTimeout(180_000);
  let A = null;
  try {
    A = await bootPeer(browser, 'A');
    await gotoCircles(A.page);
    // the switch sits under the gear on Mij, in Weergave (since 2026-10-23; before that in My data)
    const openMij = async () => {
      await A.page.locator('[data-tab="mij"]').first().click();
      await A.page.locator('.cc-profile__gear').first().click();
      await A.page.locator('.cc-settings__group--appearance').first().click();
    };
    await openMij();
    const toggle = A.page.locator('.cc-profile__week-toggle').first();
    await expect(toggle, 'Weergave offers the week overview').toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute('data-on', 'false');
    await toggle.click();
    await expect(toggle, 'switched on').toHaveAttribute('data-on', 'true', { timeout: 15_000 });
    log('STEP1 switched on', 'PASS', '');

    await A.page.reload();
    await gotoCircles(A.page);
    await openMij();
    await expect(A.page.locator('.cc-profile__week-toggle').first(), 'still on after a reload (a row in the own store)').toHaveAttribute('data-on', 'true', { timeout: 30_000 });
    log('STEP2 reload', 'PASS', 'the row is kept');

    // what the clock does when the row is due: the op, through the person's own agent
    await A.page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 30_000 });
    const r = await A.page.evaluate(async () => window.onderlingCall('basis', 'personWeekOverview', {}));
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    const card = A.page.locator('.cc-person-card').first();
    await expect(card, 'the card shows').toBeVisible({ timeout: 10_000 });
    await expect(card.locator('.cc-person-card__note')).toContainText(/app open|app is open/);
    await card.locator('.cc-person-card__close').click();
    await expect(A.page.locator('.cc-person-card')).toHaveCount(0);
    log('STEP3 card', 'PASS', 'shown, honest, closed');
  } finally {
    await teardown([A].filter(Boolean));
  }
});
