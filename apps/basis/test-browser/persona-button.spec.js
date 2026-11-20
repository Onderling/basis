/**
 * THE PERSONA BUTTON, ON A REAL SCREEN (2026-10-15; the persona panel since 2026-11-20). Top-right on every tab: the
 * person's initials (or picture); a tap opens the persona panel over the tab, whose "Aanpassen" is their own editor; a
 * new name shows in the button once the editor closes. The settings button sits beside it.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/persona-button.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the persona button is on every tab with the settings button, opens the panel, and follows a new name', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tab="mij"]'), 'Mij is no tab').toHaveCount(0);
  for (const tab of ['screens', 'circles', 'contacten']) {
    await page.locator(`[data-tab="${tab}"]`).first().click();
    await expect(page.locator('.cc-persona-button__button'), `on ${tab}`).toBeVisible();
    await expect(page.locator('.cc-persona-button__settings'), `the settings button on ${tab}`).toBeVisible();
  }
  await page.locator('[data-tab="circles"]').first().click();
  await page.locator('.cc-persona-button__button').click();
  await expect(page.locator('.cc-persona-panel'), 'the panel opens over the tab').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-tab="circles"]')).toHaveClass(/is-active/);
  await page.locator('.circle-screen__identity-edit').click();
  await expect(page.locator('.cc-screen-panel .cc-profile__display'), 'the editor opens from any tab').toBeVisible({ timeout: 15_000 });
  await page.locator('.cc-screen-panel .cc-profile__display').fill('Anna Bakker');
  await page.locator('.cc-screen-panel .cc-profile__save').click();
  await page.waitForTimeout(1500);
  await page.locator('.cc-screen-panel__close').click();
  await expect(page.locator('.cc-persona-button__initials')).toHaveText('AB', { timeout: 15_000 });
  expect(errs).toEqual([]);
});
