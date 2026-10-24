/**
 * APPARATEN & SLEUTELS UNDER THE GEAR (2026-10-24). Instellingen → Apparaten & sleutels holds the key acts (backup,
 * restore, the recovery file, enrol), and where your data lives; a wizard opened there closes back onto it. The old
 * My data page keeps none of them.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-devices.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Apparaten & sleutels holds the key acts and storage; the old page has neither', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__group--devices-keys').click();
  for (const id of ['keys', 'storage']) {
    await expect(page.locator(`[data-section="${id}"]`).first(), id).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.locator('[data-section="keys"] .cc-mydata__recovery-export')).toBeVisible();

  // the old My data page no longer paints them (a group screen hides the tab bar: come back in from the top)
  await page.goto('/');
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__mydata').first().click();
  await expect(page.locator('.cc-mydata__title')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-mydata .cc-mydata__recovery-export, .cc-mydata .cc-mydata__signin, .cc-mydata [data-section="storage"]'), 'none on the old page').toHaveCount(0);
  expect(errs).toEqual([]);
});
