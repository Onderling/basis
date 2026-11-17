/**
 * TODAY'S FOLDED STRIP AT PHONE WIDTH (390 px): shots of Today with set-up cards left (closed, then open) and with
 * none left (only the no-circle line). Written for the review of the fold; the asserts keep it honest.
 *
 *   npx playwright test --project=no-relay test-browser/today-fold-shots.spec.js
 */
import { test, expect } from '@playwright/test';
import { openOnboardingStrip } from './helpers.js';

test.setTimeout(120_000);

test('Today at 390 px: the strip closed and open, then with nothing left to set up', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 });
  const strip = page.locator('.circle-screen__onb-strip');
  await expect(strip).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: info.outputPath('today-fold-1-closed.png'), fullPage: true });
  await openOnboardingStrip(page);
  await page.screenshot({ path: info.outputPath('today-fold-2-open.png'), fullPage: true });

  const card = (id) => page.locator(`.circle-screen__onb-card[data-card="${id}"]`);
  // done, one by one: the name, the introduction, the key
  await card('handle').locator('.circle-screen__onb-handle').fill('Sam');
  await card('handle').locator('button[type="submit"]').click();
  await expect(card('handle')).toHaveCount(0, { timeout: 20_000 });
  await card('intro').locator('.circle-screen__onb-btn--ghost').click();
  await expect(card('intro')).toHaveCount(0, { timeout: 20_000 });
  if (await card('key').count()) {
    await card('key').locator('.circle-screen__onb-btn').first().click();
    await page.locator('[data-testid="mnemonic-written"]').click({ timeout: 20_000 });
    await expect(card('key')).toHaveCount(0, { timeout: 20_000 });
  }
  if (await card('reach').count() === 0) {
    await expect(strip, 'nothing left to set up: no strip').toHaveCount(0, { timeout: 20_000 });
  }
  await expect(page.locator('.circle-screen__onb-nocircle'), 'in no circle: the one line').toBeVisible();
  await page.screenshot({ path: info.outputPath('today-fold-3-none-left.png'), fullPage: true });
});
