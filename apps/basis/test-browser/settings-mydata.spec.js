/**
 * MIJN GEGEVENS UNDER THE GEAR (2026-10-24). Instellingen → Mijn gegevens holds message cleanup and what you use most
 * (always there), and the history mirror, privacy and usage where the host has them; the old My data page paints
 * none of them.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-mydata.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Mijn gegevens holds cleanup and most-used; the old page has neither', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__group--my-data').click();
  for (const id of ['message-cleanup', 'frequent']) {
    await expect(page.locator(`[data-section="${id}"]`), id).toBeVisible({ timeout: 15_000 });
  }
  // the cleanup is still two clicks: the first arms it
  const run = page.locator('[data-section="message-cleanup"] .cc-mydata__cleanup-run');
  await run.click();
  await expect(run).toHaveClass(/is-armed/);

  // the old My data page no longer paints them (a group screen hides the tab bar: come back in from the top)
  await page.goto('/');
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__mydata').first().click();
  await expect(page.locator('.cc-mydata__title')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-mydata .cc-mydata__cleanup-run, .cc-mydata .cc-mydata__history-toggle, .cc-mydata .cc-mydata__frequent-clear'), 'none on the old page').toHaveCount(0);
  expect(errs).toEqual([]);
});
