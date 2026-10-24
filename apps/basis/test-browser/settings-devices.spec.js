/**
 * APPARATEN & SLEUTELS UNDER THE GEAR (2026-10-24). Instellingen → Apparaten & sleutels holds the key acts (backup,
 * restore, the recovery file, enrol), and where your data lives. The build's version line is at the foot of
 * Instellingen.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-devices.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Apparaten & sleutels holds the key acts and storage; the version line is at the foot of Instellingen', async ({ page }) => {
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

  // and the version line sits at the foot of Instellingen
  await page.locator('.cc-mydata__back').first().click();
  await expect(page.locator('.cc-settings__version')).toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});
