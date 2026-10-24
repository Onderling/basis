/**
 * THE HELP BOT IS A CONTACT: on a fresh device Contacten shows one row for Onderling, the help bot, and its tap opens
 * the help conversation; the circles launcher paints no help tile ("Uitleg" / "Help") any more (the door moved, the data stayed).
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/help-as-contact.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('Contacten holds the help bot; the launcher has no help tile', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  // the help circle is provisioned on boot: wait for it to be in the list before reading either door
  await expect.poll(() => page.evaluate(async () => ((await window.onderlingCall('pinboard', 'listMyCircles', {}))?.circles ?? [])
    .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).includes('cc-help')), { timeout: 20_000 }).toBe(true);

  await page.locator('[data-tab="circles"]').first().click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-tile', { hasText: /Uitleg|Help/ }), 'no help tile on the launcher').toHaveCount(0);

  await page.locator('[data-tab="contacten"]').first().click();
  const row = page.locator('.cc-contacts__row[data-synthetic="true"]');
  await expect(row, 'one help-bot row in Contacten').toHaveCount(1, { timeout: 20_000 });
  await expect(row.locator('.cc-contacts__name')).toHaveText('Onderling');
  await row.click();
  await expect(page.locator('.circle-view__title'), 'its tap opens the help conversation').toContainText(/Uitleg|Help/, { timeout: 20_000 });
  expect(errs).toEqual([]);
});
