/**
 * HOW FAR THE "+" GOES, chosen on the persona's card (ledger L977, D.3b). The person's editor (the persona button) shows
 * each persona's card with the four choices; 3 is in force by default; a tap sets it on that persona through its own op,
 * read back through the waist (`agents.getPlusCeiling`), and the card then marks the new choice.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/mij-plus-ceiling.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('a persona card offers how far the "+" goes; a tap sets it on that persona', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });

  await page.locator('.cc-persona-button__button').click();
  const choice = (n) => page.locator(`[data-testid="mij-plus-ceiling-default-${n}"]`);
  await expect(choice(3), 'a circle\'s things after a yes: in force by default').toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect(choice(1)).toHaveAttribute('aria-pressed', 'false');

  await choice(1).click();
  await expect(choice(1)).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  const read = await page.evaluate(async () => window.onderlingCall('agents', 'getPlusCeiling', { id: 'default' }));
  expect(read?.ceiling, JSON.stringify(read)).toBe(1);
  expect(errs).toEqual([]);
});
