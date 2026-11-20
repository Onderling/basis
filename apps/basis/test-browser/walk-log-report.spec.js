/**
 * THE COPY-LOG DOOR, ON A REAL SCREEN (2026-10-23). Instellingen → "Meld een probleem" (beside Feedback geven) opens this device's log as text (event codes and numbers
 * only), Copy puts exactly that text on the clipboard, and Back returns to the settings home. Nothing is sent from the screen.
 *
 *   PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-log-report.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('Meld een probleem shows the log as text, Copy copies exactly it, Back returns', async ({ browser }) => {
  test.setTimeout(120_000);
  let A = null;
  try {
    A = await bootPeer(browser, 'A');
    await A.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoCircles(A.page);
    await A.page.locator('.cc-persona-button__settings').click();
    const door = A.page.locator('.cc-settings__door-row--log-report').first();
    await expect(door, 'the settings home offers the copy-log door').toBeVisible({ timeout: 30_000 });
    await door.click();

    const text = A.page.locator('.cc-logreport__text').first();
    await expect(text).toBeVisible({ timeout: 15_000 });
    const shown = await text.textContent();
    expect(shown.startsWith('bug-report · basis '), shown.slice(0, 80)).toBe(true);
    log('STEP1 open', 'PASS', shown.split('\n')[0]);

    await A.page.locator('.cc-logreport__copy').first().click();
    await expect(A.page.locator('.cc-logreport__copied').first()).not.toBeEmpty({ timeout: 5_000 });
    const copied = await A.page.evaluate(() => navigator.clipboard.readText());
    expect(copied, 'the clipboard holds exactly the shown text').toBe(shown);
    log('STEP2 copy', 'PASS', `${copied.length} chars`);

    await A.page.locator('.cc-logreport__back').first().click();
    await expect(A.page.locator('.cc-settings__door-row--log-report').first(), 'back on the settings home').toBeVisible({ timeout: 15_000 });
    log('STEP3 back', 'PASS', '');
  } finally {
    await teardown([A].filter(Boolean));
  }
});
