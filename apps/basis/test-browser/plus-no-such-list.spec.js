/**
 * A "+" LINE THAT PUTS SOMETHING ON A LIST NOBODY HOLDS asks to make that list (the person's own), never a chore by the
 * tasks phrasing: "zet melk op boodschappen" with no list of that name → "Een lijst 'boodschappen' bestaat nog niet.
 * Maken?"; nothing runs before the yes; after it, the list is the person's own.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-no-such-list.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('a list nobody holds: the "+" asks to make it; the yes makes an own list, nothing before it', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').click();
  const line = page.locator('.circle-vandaag-plus__line');
  await line.fill('zet melk op boodschappen');
  await line.press('Enter');
  const card = page.locator('.circle-vandaag-plus__card');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(/boodschappen/);
  await expect(card).toContainText(/bestaat nog niet|no list/);
  // nothing ran before the yes: no task, no list
  const tasks = await page.evaluate(() => window.onderlingCall?.('tasks', 'listOpen', {}));
  expect(JSON.stringify(tasks ?? {})).not.toContain('melk');
  await card.locator('.circle-vandaag-plus__card-in').first().click();
  await expect(page.locator('.circle-vandaag-plus__turn--assistant').last()).toContainText(/boodschappen/i, { timeout: 15_000 });
  // the list is the person's own now: the next line about it reads to it, no card
  await line.fill('zet melk op boodschappen');
  await line.press('Enter');
  await expect(page.locator('.circle-vandaag-plus__turn--assistant').last()).toContainText(/melk/, { timeout: 15_000 });
  await expect(card).toHaveCount(0);
  expect(errs).toEqual([]);
});

test('the yes puts the item on the new list too; a no is said and makes nothing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').click();
  const line = page.locator('.circle-vandaag-plus__line');
  const card = page.locator('.circle-vandaag-plus__card');
  const last = () => page.locator('.circle-vandaag-plus__turn--assistant').last();
  // a no: said in the thread, nothing made
  await line.fill('zet brood op vakantie');
  await line.press('Enter');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.locator('.circle-vandaag-plus__card-no').click();
  await expect(last()).toContainText(/niet gedaan|not done/, { timeout: 15_000 });
  // a yes: the list AND the item on it
  await line.fill('zet melk op boodschappen');
  await line.press('Enter');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.locator('.circle-vandaag-plus__card-in').first().click();
  await expect(card).toHaveCount(0);
  await line.fill('wat staat er op boodschappen');
  await line.press('Enter');
  await expect(last()).toContainText(/melk/, { timeout: 15_000 });
});
