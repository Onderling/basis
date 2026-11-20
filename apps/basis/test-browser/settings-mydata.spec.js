/**
 * MIJN GEGEVENS UNDER THE SETTINGS BUTTON (regrouped 2026-11-20). Instellingen → Mijn gegevens holds message cleanup and
 * what you use most (always there), the history mirror, privacy and usage where the host has them, what this device
 * keeps and the pod; the log report ("Meld een probleem") is a door on the home, beside Feedback geven.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-mydata.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Mijn gegevens holds cleanup, most-used, what this device keeps and the pod; the log report is on the home', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.cc-persona-button__button')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('.cc-persona-button__settings').click();
  await page.locator('.cc-settings__group--my-data').click();
  for (const id of ['message-cleanup', 'frequent', 'device-keeps', 'storage']) {
    await expect(page.locator(`[data-section="${id}"]`), id).toBeVisible({ timeout: 15_000 });
  }
  // the cleanup is still two clicks: the first arms it
  const run = page.locator('[data-section="message-cleanup"] .cc-mydata__cleanup-run');
  await run.click();
  await expect(run).toHaveClass(/is-armed/);

  // the log report is a door on the home, right after Feedback geven, and comes back to the home
  await page.locator('.cc-mydata__back').first().click();
  const doors = await page.locator('.cc-settings__door-row').evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(doors.slice(doors.indexOf('feedback'), doors.indexOf('feedback') + 2)).toEqual(['feedback', 'log-report']);
  await page.locator('.cc-settings__door-row--log-report').click();
  await expect(page.locator('.cc-logreport__text').first(), 'the log report').toBeVisible({ timeout: 15_000 });
  await page.locator('.cc-logreport__back').first().click();
  await expect(page.locator('.cc-settings__door-row--log-report'), 'back on the settings home').toBeVisible({ timeout: 15_000 });
  // there is no old My data page (a group screen hides the tab bar: come back in from the top)
  await page.goto('/');
  await page.locator('.cc-persona-button__button').click();
  await expect(page.locator('.cc-profile__mydata'), 'Mij has no My data door: the gear is the one way in').toHaveCount(0);
  expect(errs).toEqual([]);
});
