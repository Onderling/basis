/**
 * The circle's conversation starts with its content: no filter chip rows, no "this only changes what you see here"
 * line, no frame around the log; an item in it carries a small kind chip in words ("Taak"), never its raw kind.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/circle-kind-chip.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle, sendCircle } from './helpers.js';

test.setTimeout(120_000);

test('the conversation has no filter rows and no frame, and an item carries its kind chip in words', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await bootCircle(page, 'Chip Kring', { tasks: true });
  await expect(page.locator('.circle-view__filter'), 'no filter chip rows').toHaveCount(0);
  await expect(page.locator('.circle-view'), 'no explainer line').not.toContainText(/only changes what you see|verandert alleen wat jij/);
  const border = await page.locator('.circle-view__chat-card').evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(border, 'no frame around the conversation').toBe('0px');

  // an item in the conversation reads by its kind in words, from the one item-kind vocabulary (icon + word)
  await sendCircle(page, '/addtask ladder halen');
  await expect(page.locator('.circle-view__embed--task').first()).toHaveText(/^✅ (Task|Taak): ladder halen$/, { timeout: 15_000 });
  await expect(page.locator('.circle-view__bubble-kind', { hasText: /^[A-Z]+$/ }), 'never a raw kind in capitals').toHaveCount(0);
  await page.screenshot({ path: 'test-results/circle-kind-chip.png' });
  expect(errs).toEqual([]);
});
