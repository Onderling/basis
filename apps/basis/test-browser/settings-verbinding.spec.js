/**
 * VERBINDING UNDER THE SETTINGS BUTTON (regrouped 2026-11-20). Instellingen → Verbinding holds the connection points (a
 * door to their screen), the relay (edited inline, as on the phone), my address on the network and receipts.
 * Availability is no longer here (it is on Vandaag). Geblokkeerd is a door at the foot of Contacten, and comes back there.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-verbinding.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Verbinding holds the connection settings; Geblokkeerd lives on Contacten', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.cc-persona-button__button')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('.cc-persona-button__settings').click();
  await page.locator('.cc-settings__group--connection').click();
  for (const id of ['connection-points', 'delivery', 'relay']) {
    await expect(page.locator(`[data-section="${id}"]`), id).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.locator('[data-section="availability"]'), 'availability left Verbinding (it is on Vandaag)').toHaveCount(0);
  await expect(page.locator('.cc-mydata__relay-input'), 'the relay is edited inline').toBeVisible();
  await expect(page.locator('.cc-mydata__relay-open'), 'no side panel for the relay').toHaveCount(0);

  // a door opens its screen
  await page.locator('.cc-settings__door--connection-points').click();
  await expect(page.locator('.cc-settings__door--connection-points'), 'the points screen replaced Verbinding').toHaveCount(0, { timeout: 15_000 });

  // Geblokkeerd at the foot of Contacten, and back there (a settings screen hides the tab bar: come back in from the top)
  await page.goto('/');
  await page.locator('[data-tab="contacten"]').first().click();
  await page.locator('.cc-contacts__blocked').click();
  await page.locator('.cc-blocked__back').click();
  await expect(page.locator('.cc-contacts__blocked'), 'back on Contacten').toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});
