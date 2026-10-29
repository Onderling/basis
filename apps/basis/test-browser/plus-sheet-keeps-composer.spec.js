/**
 * THE "+" OPENS AS A SHEET, NEVER SQUEEZING THE COMPOSER. Opening a circle's "+" once laid its acts inline beside the
 * input and narrowed it to a sliver (the 2026-10-22 screen walk). The acts open above the composer; the input keeps
 * its width and stays usable while they are shown.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-sheet-keeps-composer.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(120_000);

test('opening the circle "+" leaves the composer input its width, and the acts open above it', async ({ page }) => {
  await bootCircle(page, 'Plus Kring');
  const plus = page.locator('.circle-view__attach').first();
  const input = page.locator('.circle-view__composer-input').first();
  await expect(plus).toBeVisible({ timeout: 20_000 });
  await expect(input).toBeVisible();
  const before = await input.boundingBox();

  const item = page.locator('.circle-view__attach-item').first();
  await expect.poll(async () => { if (!(await item.isVisible())) await plus.click(); return item.isVisible(); },
    { timeout: 20_000, message: 'the "+" shows its acts' }).toBe(true);

  const after = await input.boundingBox();
  expect(Math.abs(after.width - before.width), `the input kept its width (${before.width} → ${after.width})`).toBeLessThan(2);
  const itemBox = await item.boundingBox();
  expect(itemBox.y + itemBox.height, 'the acts sit above the input, not beside it').toBeLessThanOrEqual(after.y + 1);
  await input.fill('nog steeds te typen');
  await expect(input).toHaveValue('nog steeds te typen');
});
