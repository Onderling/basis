/**
 * VERBINDING UNDER THE GEAR (2026-10-24). Instellingen → Verbinding holds availability and connection points (doors,
 * each opening its screen and coming back here), delivery, the address lock, the relay and what this device keeps; the
 * old My data page has none of them, and keeps only its log-report door. Geblokkeerd is a door at the foot of
 * Contacten, and comes back there.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-verbinding.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Verbinding holds the connection settings; Geblokkeerd lives on Contacten', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__group--connection').click();
  for (const id of ['availability', 'connection-points', 'delivery', 'relay']) {
    await expect(page.locator(`[data-section="${id}"]`), id).toBeVisible({ timeout: 15_000 });
  }

  // a door opens its screen
  await page.locator('.cc-settings__door--availability').click();
  await expect(page.locator('.cc-settings__door--availability'), 'the availability screen replaced Verbinding').toHaveCount(0, { timeout: 15_000 });

  // the old My data page no longer has the connection sections nor their doors
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__mydata').first().click();
  await expect(page.locator('.cc-mydata__title')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-mydata .cc-mydata__relay-open, .cc-mydata .cc-mydata__relay-input'), 'no relay on the old page').toHaveCount(0);
  await expect(page.locator('.cc-mydata__doors .cc-profile__availability, .cc-mydata__doors .cc-profile__blocked')).toHaveCount(0);

  // Geblokkeerd at the foot of Contacten, and back there (My data hides the tab bar: back to Mij first)
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('[data-tab="contacten"]').first().click();
  await page.locator('.cc-contacts__blocked').click();
  await page.locator('.cc-blocked__back').click();
  await expect(page.locator('.cc-contacts__blocked'), 'back on Contacten').toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});
