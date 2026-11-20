/**
 * THE SETTINGS BUTTON (regrouped 2026-11-20). Its home lists the declared groups and then "Per kring"; Weergave holds
 * the theme, the language, where the app opens and the "+"'s middle; Meldingen the notifications and the week overview
 * (a real switch); Assistent the own model and how the bot shows actions.
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
  await expect(page.locator('.cc-persona-button__button')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('.cc-persona-button__settings').click();
  const rows = page.locator('.cc-settings__row');
  await expect(rows.first(), 'the home lists the groups').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-settings__per-circle'), 'Per kring is the last row').toBeVisible();

  await page.locator('.cc-settings__group--appearance').click();
  for (const id of ['theme', 'language', 'start-screen']) {
    await expect(page.locator(`[data-section="${id}"]`), id).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.locator('[data-section="notifications"]'), 'notifications moved to Meldingen').toHaveCount(0);

  // a setting changes live: dark theme
  await page.locator('[data-section="theme"] button', { hasText: /donker|dark/i }).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? '')).toBe('dark');

  // Meldingen: notifications and the week overview (a real switch)
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('.cc-settings__group--notifications').click();
  await expect(page.locator('[data-section="notifications"]'), 'notifications').toBeVisible({ timeout: 15_000 });
  const week = page.locator('.cc-profile__week-toggle');
  if (await week.count()) await expect(week, 'the week overview is a switch').toHaveAttribute('role', 'switch');
  // Assistent: the own model; 'How the bot shows actions' is about a bot that ACTS, and a fresh profile has Help as its
  // only bot, so that section is not offered (the shared predicate showsBotActionsSetting, both shells, ruled 2026-11-07)
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('.cc-settings__group--assistant').click();
  await expect(page.locator('[data-section="assistant"]'), 'the own model').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-section="bot-actions"]'), 'no bot setting while the only bot is Help').toHaveCount(0);

  // back to the home, then Per kring: the circles, each a door to its own settings
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('.cc-settings__per-circle').click();
  await expect(page.locator('.cc-settings__circle, .cc-settings__fact').first()).toBeVisible({ timeout: 15_000 });

  // back, back: the home, then the tab the settings button was tapped on
  await page.locator('.cc-mydata__back').first().click();
  await expect(page.locator('.cc-settings__per-circle')).toBeVisible({ timeout: 15_000 });
  await page.locator('.cc-mydata__back').first().click();
  await expect(page.locator('.circle-tabbar__tab.is-active'), 'back on the tab it was opened from').toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});
