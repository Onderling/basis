/**
 * A CIRCLE'S LISTS ON VANDAAG. Lists are a circle's own, and the circle's screen is not in the alpha, so the person puts
 * a lists block on their own page, scoped to one circle ("Pas aan" → Lijsten → which circle). It shows that circle's
 * lists and their open entries; an entry is ticked off from there. The circle's "+" offers making a list only where
 * lists are on in the circle AND a lists block for it is on one of the person's pages.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag-lists-block.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(180_000);

const NAME = 'Lijsten Kring';

test('a lists block for one circle on Vandaag shows its lists; an entry ticks off; the "+" offers a new list', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await bootCircle(page, NAME);
  // the circle's id, from its own tile (then open it again)
  await page.locator('.circle-view__back').click();
  await page.waitForTimeout(800);
  const tile = page.locator('.circle-tile', { hasText: NAME }).first();
  const circleId = await tile.getAttribute('data-circle-id');
  await tile.click();
  await page.waitForTimeout(1500);
  expect(circleId, 'the circle exists').toBeTruthy();

  // the circle's lists switched on (the admin's setting; the toggle is back now lists have a surface)
  await page.locator('.circle-view__more').click();
  await page.locator('.circle-view__more-item[data-action="settings"]').click();
  const box = page.locator('input[data-feature="lists"]');
  await expect(box, 'Lijsten is a circle feature again').toBeVisible({ timeout: 10_000 });
  if (!(await box.isChecked())) await box.check();
  await page.locator('.circle-settings__save').click();
  await page.waitForTimeout(800);

  // a list with one entry, through the lists' own ops
  const made = await page.evaluate(async (cid) => {
    const a = await window.onderlingCall('lists', 'createList', { circleId: cid, text: 'Boodschappen' });
    const b = await window.onderlingCall('lists', 'addToList', { circleId: cid, list: 'Boodschappen', text: 'melk' });
    return { a, b };
  }, circleId);
  expect(made.a?.ok, JSON.stringify(made)).not.toBe(false);
  expect(made.b?.ok, JSON.stringify(made)).not.toBe(false);

  // out of the circle, then Vandaag → Pas aan → add Lijsten → pick the circle
  for (const sel of ['.circle-settings__back', '.circle-view__back']) {
    const b = page.locator(sel);
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(800); }
  }
  await page.locator('[data-tab="screens"]').first().click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__customise').click();
  await page.locator('.vandaag-customise [data-act="add"]', { hasText: /^(Lijsten|Lists)$/ }).click();
  const pick = page.locator('.vandaag-customise select[data-control="circleId"]').last();
  await expect(pick, 'the lists block asks which circle').toBeVisible({ timeout: 10_000 });
  await pick.selectOption(circleId);
  await page.locator('.vandaag-customise [data-act="done"]').click();

  const title = page.locator('.circle-screen__block[data-block-type="lists"] .circle-screen__list-title', { hasText: 'Boodschappen' });
  await expect(title, "the circle's list on Vandaag").toBeVisible({ timeout: 20_000 });
  const entry = page.locator('.circle-screen__block[data-block-type="lists"] .circle-screen__list-entry', { hasText: 'melk' });
  await expect(entry).toBeVisible();
  await entry.locator('.circle-screen__row-act').click();
  await expect(entry, 'ticked off: no longer an open entry').toHaveCount(0, { timeout: 20_000 });

  // the circle's "+" now offers making a list (lists on, and a lists block for this circle on a page)
  await page.locator('[data-tab="circles"]').first().click();
  await page.locator('.circle-tile', { hasText: NAME }).first().click();
  const plus = page.locator('.circle-view__attach').first();
  await expect(plus).toBeVisible({ timeout: 20_000 });
  const newList = page.locator('.circle-view__attach-item[data-op-id="createList"]');
  await expect.poll(async () => { if (!(await newList.count())) { await plus.click(); await page.waitForTimeout(300); } return newList.count(); },
    { timeout: 20_000, message: 'the "+" offers a new list' }).toBeGreaterThan(0);
  expect(errs).toEqual([]);
});
