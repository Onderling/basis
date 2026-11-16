/**
 * THE "+" SAYS WHAT CAN BE TYPED HERE, ON A REAL SCREEN. As the person types, the "+" offers the lines it reads with
 * their circles (the gate's own examples, each only where it works); a tap puts the line in to finish. Web twin of the
 * phone's sheet.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-suggestions.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('typing in the "+" offers lines it reads here; a tap puts one in the line', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').click();
  const line = page.locator('.circle-vandaag-plus__line');
  // the pool is read once the sheet is open (the circles' offers are asynchronous): type once it has had a moment
  await page.waitForTimeout(1500);
  await line.pressSequentially('onthoud');
  const offered = page.locator('.circle-vandaag-plus__suggestion');
  await expect(offered.first(), 'an own-note line is offered').toBeVisible({ timeout: 10_000 });
  const first = await offered.first().textContent();
  expect(first.toLowerCase()).toContain('onthoud');
  await offered.first().click();
  await expect(line).toHaveValue(first);
  expect(errs).toEqual([]);
});
