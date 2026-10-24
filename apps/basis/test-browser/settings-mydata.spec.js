/**
 * MIJN GEGEVENS UNDER THE GEAR (2026-10-24). Instellingen → Mijn gegevens holds message cleanup and what you use most
 * (always there), the history mirror, privacy and usage where the host has them, and the log report's door; there is
 * no other My data page, and Mij has no door to one.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-mydata.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Mijn gegevens holds cleanup, most-used and the log report; there is no old page', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__group--my-data').click();
  for (const id of ['message-cleanup', 'frequent']) {
    await expect(page.locator(`[data-section="${id}"]`), id).toBeVisible({ timeout: 15_000 });
  }
  // the cleanup is still two clicks: the first arms it
  const run = page.locator('[data-section="message-cleanup"] .cc-mydata__cleanup-run');
  await run.click();
  await expect(run).toHaveClass(/is-armed/);

  // the log report is a door here, and comes back here
  await page.locator('.cc-settings__door--log-report').click();
  await expect(page.locator('.cc-settings__door--log-report'), 'the log report replaced Mijn gegevens').toHaveCount(0, { timeout: 15_000 });
  // there is no old My data page (a group screen hides the tab bar: come back in from the top)
  await page.goto('/');
  await page.locator('[data-tab="mij"]').first().click();
  await expect(page.locator('.cc-profile__mydata'), 'Mij has no My data door: the gear is the one way in').toHaveCount(0);
  expect(errs).toEqual([]);
});
