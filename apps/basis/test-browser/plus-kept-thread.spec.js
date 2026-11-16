/**
 * THE "+" IS ONE KEPT CONVERSATION, ON A REAL SCREEN. What the person typed in the "+" and what it answered are still
 * there when the sheet opens again, and after a reload (the bot's own turn entries on the device's log); Forget empties
 * it. Web twin of the phone's sheet.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-kept-thread.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the "+" opens on the conversation so far, also after a reload; Forget empties it', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });

  // a line the "+" cannot read: the person's turn and its answer ("I could not read that") are both kept
  await page.locator('.circle-vandaag__plus').click();
  await expect(page.locator('.circle-vandaag-plus__thread'), 'a fresh person has no conversation yet').toHaveCount(0);
  await page.locator('.circle-vandaag-plus__line').fill('blauwe olifanten dansen');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  const turns = page.locator('.circle-vandaag-plus__turn');
  await expect(turns.first(), 'the line is in the thread at once').toHaveText('blauwe olifanten dansen', { timeout: 10_000 });
  await expect(turns, 'the line and the answer').toHaveCount(2);
  await expect(turns.nth(1)).toHaveClass(/circle-vandaag-plus__turn--assistant/);

  // closed and opened again: the same conversation
  await page.locator('.circle-vandaag-plus__close').click();
  await page.locator('.circle-vandaag__plus').click();
  await expect(turns.first()).toHaveText('blauwe olifanten dansen');

  // a reload keeps it (the device's log is kept)
  // the device log saves on a short debounce (as for every line on it: history-survives-reload waits the same)
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').click();
  await expect(page.locator('.circle-vandaag-plus__turn').first(), 'kept across a reload').toHaveText('blauwe olifanten dansen', { timeout: 15_000 });

  // Forget empties it
  await page.locator('.circle-vandaag-plus__forget').click();
  await expect(page.locator('.circle-vandaag-plus__thread')).toHaveCount(0);
  expect(errs).toEqual([]);
});
