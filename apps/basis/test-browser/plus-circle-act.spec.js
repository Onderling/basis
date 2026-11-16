/**
 * THE "+" ACTS IN A CIRCLE WHERE THE CIRCLE IS CLEAR. One circle holds a Boodschappen list; "zet melk op de
 * boodschappen" typed in the "+" goes on that list at once, as the person, and the sheet says what it did. The circle's
 * own ops read it back: the line is there.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-circle-act.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(180_000);

const NAME = 'Plus Kring';

test('"zet melk op de boodschappen" in the "+" lands on the one circle that has that list', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await bootCircle(page, NAME);
  await page.locator('.circle-view__back').click();
  await page.waitForTimeout(800);
  const tile = page.locator('.circle-tile', { hasText: NAME }).first();
  const circleId = await tile.getAttribute('data-circle-id');
  expect(circleId, 'the circle exists').toBeTruthy();

  // the circle's lists on (the admin's setting), and its shopping list, through the lists' own ops
  await tile.click();
  await page.waitForTimeout(1500);
  await page.locator('.circle-view__more').click();
  await page.locator('.circle-view__more-item[data-action="settings"]').click();
  const box = page.locator('input[data-feature="lists"]');
  await expect(box).toBeVisible({ timeout: 10_000 });
  if (!(await box.isChecked())) await box.check();
  await page.locator('.circle-settings__save').click();
  await page.waitForTimeout(800);
  const made = await page.evaluate((cid) => window.onderlingCall('lists', 'createList', { circleId: cid, text: 'Boodschappen' }), circleId);
  expect(made?.ok, JSON.stringify(made)).not.toBe(false);
  for (const sel of ['.circle-settings__back', '.circle-view__back']) {
    const b = page.locator(sel);
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(800); }
  }

  // the "+" line, on Vandaag
  await page.locator('[data-tab="screens"]').first().click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__line').fill('zet melk op de boodschappen');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(page.locator('.circle-vandaag-plus__card'), 'one circle holds the list: no card, it runs').toHaveCount(0);
  await expect(page.locator('.circle-vandaag-plus__done'), 'the sheet says what it did').toBeVisible({ timeout: 15_000 });

  // the circle's own read: melk is on its Boodschappen
  const entries = await page.evaluate((cid) => window.onderlingCall('lists', 'listEntries', { circleId: cid, list: 'Boodschappen' }), circleId);
  expect((entries?.items ?? []).map((e) => e.label), JSON.stringify(entries)).toContain('melk');
  expect(errs, errs.join('\n')).toEqual([]);
});
