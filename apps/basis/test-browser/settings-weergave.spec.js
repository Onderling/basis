/**
 * THE GEAR ON MIJ (2026-10-23). Mij's header has a gear: Instellingen. Its home lists the declared groups and then
 * "Per kring"; Weergave holds the theme, the language, where the app opens, how the bot shows actions, the week
 * overview (a real switch), notifications and the assistant — and the old My data page no longer shows any of them.
 * "Per kring" lists the person's circles, each opening that circle's own settings.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-weergave.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('the gear opens Instellingen; Weergave holds the appearance settings, Per kring the circles\' own', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  const rows = page.locator('.cc-settings__row');
  await expect(rows.first(), 'the home lists the groups').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-settings__per-circle'), 'Per kring is the last row').toBeVisible();

  await page.locator('.cc-settings__group--appearance').click();
  for (const id of ['theme', 'language', 'bot-actions', 'notifications']) {
    await expect(page.locator(`[data-section="${id}"]`), id).toBeVisible({ timeout: 15_000 });
  }
  const week = page.locator('.cc-profile__week-toggle');
  if (await week.count()) await expect(week, 'the week overview is a switch').toHaveAttribute('role', 'switch');

  // a setting changes live: dark theme
  await page.locator('[data-section="theme"] button', { hasText: /donker|dark/i }).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? '')).toBe('dark');

  // back to the home, then Per kring: the circles, each a door to its own settings
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('.cc-settings__per-circle').click();
  await expect(page.locator('.cc-settings__circle, .cc-settings__fact').first()).toBeVisible({ timeout: 15_000 });

  // back, back: the home, then Mij — and the old My data page no longer paints the appearance sections
  await page.locator('.cc-mydata__back').first().click();
  await expect(page.locator('.cc-settings__per-circle')).toBeVisible({ timeout: 15_000 });
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('.cc-profile__mydata').first().click();
  await expect(page.locator('.cc-mydata__title')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-mydata .cc-mydata__theme-toggle'), 'no theme on the old page').toHaveCount(0);
  expect(errs).toEqual([]);
});
