/**
 * THE HEADER AVATAR, ON A REAL SCREEN (2026-10-15). Top-right on every tab: the person's initials (or picture); a tap
 * opens their own editor, wherever they are; a new name shows in the avatar once the editor closes.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/header-avatar.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the avatar is on every tab, opens the editor, and follows a new name', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  for (const tab of ['screens', 'circles', 'contacten', 'mij']) {
    await page.locator(`[data-tab="${tab}"]`).first().click();
    await expect(page.locator('.cc-header-avatar__button'), `on ${tab}`).toBeVisible();
  }
  await page.locator('[data-tab="circles"]').first().click();
  await page.locator('.cc-header-avatar__button').click();
  await expect(page.locator('.cc-screen-panel .cc-profile__display'), 'the editor opens from any tab').toBeVisible({ timeout: 15_000 });
  await page.locator('.cc-screen-panel .cc-profile__display').fill('Anna Bakker');
  await page.locator('.cc-screen-panel .cc-profile__save').click();
  await page.waitForTimeout(1500);
  await page.locator('.cc-screen-panel__close').click();
  await expect(page.locator('.cc-header-avatar__initials')).toHaveText('AB', { timeout: 15_000 });
  expect(errs).toEqual([]);
});
