/**
 * THE "+" SAYS WHAT IT IS (the assistant plan's step B; stories 1 and 2 of its section 6).
 *   1. The first time, three lines, no model needed: what it is, that a circle's things go through the card, and
 *      examples to try built from what the person has; a tap on one puts it in the line, it does not send.
 *   2. A circle the person is now also in is said ONCE on the next open, and not again. (Here the circle is made on
 *      this device; joining one lands the same way: a circle in the person's set they were not told about.)
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-intro.spec.js
 */
import { test, expect } from '@playwright/test';
import { createCircleViaWizard } from './helpers.js';

test.setTimeout(150_000);

// A reload at once after the sheet opened can come before the log has persisted what it told (as for any entry): a
// person's next open is never that close, so each reload here waits first.
const reload = async (page) => { await page.waitForTimeout(3000); await page.goto('/'); };
const openPlus = async (page) => {
  await page.locator('[data-tab="vandaag"]').first().click().catch(() => {});
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').click();
  await expect(page.locator('.circle-vandaag-plus__line')).toBeVisible();
};

test('stories 1 and 2: the intro once with examples that fill the line; a new circle said once', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await openPlus(page);
  const opening = page.locator('.circle-vandaag-plus__opening');
  await expect(opening, 'the first open says what it is').toBeVisible({ timeout: 10_000 });
  await expect(opening.locator('.circle-vandaag-plus__intro')).toHaveCount(2);
  const examples = opening.locator('.circle-vandaag-plus__example');
  await expect(examples).toHaveCount(3);
  const first = (await examples.first().innerText()).trim();
  const turnsBefore = await page.locator('.circle-vandaag-plus__turn').count();
  await examples.first().click();
  await expect(page.locator('.circle-vandaag-plus__line'), 'a tap fills the line').toHaveValue(first);
  expect(await page.locator('.circle-vandaag-plus__turn').count(), 'and sends nothing').toBe(turnsBefore);

  // the next open: nothing to say (told once)
  await reload(page);
  await openPlus(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('.circle-vandaag-plus__opening'), 'said once').toHaveCount(0);

  // a circle in the person's set they were not told about: one line naming it, then never again
  await page.goto('/');
  await page.locator('[data-tab="circles"]').click();
  await createCircleViaWizard(page, 'Werkgroep');
  await reload(page);
  await openPlus(page);
  await expect(page.locator('.circle-vandaag-plus__news')).toContainText('Werkgroep', { timeout: 10_000 });
  await reload(page);
  await openPlus(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('.circle-vandaag-plus__news'), 'the news is said once').toHaveCount(0);
  expect(errs).toEqual([]);
});
