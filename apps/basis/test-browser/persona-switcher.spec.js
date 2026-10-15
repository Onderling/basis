/**
 * THE HEADER SWITCHER, ON A REAL SCREEN (2026-10-15). With a second persona on the device, the avatar opens the
 * switcher: untick yourself and Kringen shows only the persona's circles, the avatar is the persona's, the "+" writes
 * as it; "Alle" brings everything back. The set is a page change (an op on the screens book).
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/persona-switcher.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('the switcher narrows what the app shows to the ticked selves, and "Alle" brings it back', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const made = await page.evaluate(async () => window.onderlingCall('agents', 'createProfile', { name: 'Werk' }));
  expect(made?.created, JSON.stringify(made)).toBe(true);
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });

  await page.locator('[data-tab="circles"]').first().click();
  const tiles = page.locator('.circle-tile');
  await expect(tiles.first(), 'a fresh profile has its circle').toBeVisible({ timeout: 20_000 });
  const before = await tiles.count();

  await page.locator('.cc-header-avatar__button').click();
  await expect(page.locator('.cc-persona-switcher__row'), 'one row per self').toHaveCount(2);
  await page.locator('.cc-persona-switcher__row[data-self="default"] .cc-persona-switcher__tick').click();
  await expect(page.locator('.cc-persona-switcher__row[data-self="default"] .cc-persona-switcher__tick')).toHaveAttribute('aria-pressed', 'false');
  // the last one on cannot be turned off
  await expect(page.locator(`.cc-persona-switcher__row[data-self="${made.id}"] .cc-persona-switcher__tick`)).toBeDisabled();
  await page.locator('.cc-persona-switcher__close').click();

  await expect(tiles, 'Kringen shows only the persona\'s circles (it has none yet)').toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.cc-header-avatar__initials'), 'the avatar is the persona\'s').toHaveText('W');

  await page.locator('.cc-header-avatar__button').click();
  await page.locator('.cc-persona-switcher__all').click();
  await page.locator('.cc-persona-switcher__close').click();
  await expect(tiles).toHaveCount(before, { timeout: 15_000 });
  expect(errs).toEqual([]);
});
