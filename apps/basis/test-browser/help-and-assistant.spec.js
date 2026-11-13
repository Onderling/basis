/**
 * HELP IS FOUND FROM SETTINGS, AND ME OPENS THE ASSISTANT, ON A REAL SCREEN (walk row 78: Help was found only by opening
 * the Onderling bot's contact). Settings → Help opens the Help circle, where the bot answers; Me → Assistant opens the
 * person's ongoing conversation (the "+" sheet).
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/help-and-assistant.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('Settings → Help opens the Help circle; Me → Assistant opens the "+" conversation', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });

  // Me → Assistant: the "+" sheet opens (its line is there to type in)
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__assistant').click();
  await expect(page.locator('.circle-vandaag-plus__line'), 'the assistant conversation opened').toBeVisible({ timeout: 10_000 });
  await page.locator('.circle-vandaag-plus__close').click();

  // Settings → Help: the Help circle opens (its conversation, where the bot answers)
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__door-row--help').click();
  await expect(page.locator('.circle-view__composer-input'), 'a circle conversation opened').toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).toContainText(/Help|Hulp/);
  expect(errs).toEqual([]);
});
