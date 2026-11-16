/**
 * A CIRCLE'S LISTS ARE A TAB BESIDE TASKS (2026-11-14). The circle's settings switch for lists is the tab: on, a Lists
 * tab after Tasks; in it the person makes a list and adds an entry, the way a person does (no op called by hand).
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/circle-lists-tab.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test('lists on: a Lists tab after Tasks, where a list is made and an entry added', async ({ page }) => {
  test.setTimeout(120_000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await bootCircle(page, 'Lijst Kring');
  // the switch is the circle's settings: lists off = no tab, lists on = the tab
  const setLists = async (on) => {
    await page.locator('.circle-view__more').click();
    await page.locator('.circle-view__more-item[data-action="settings"]').click();
    const box = page.locator('input[data-feature="lists"]');
    await expect(box).toBeVisible({ timeout: 5000 });
    if ((await box.isChecked()) !== on) { if (on) await box.check(); else await box.uncheck(); }
    await page.locator('.circle-settings__save').click();
    await expect.poll(async () => (await page.locator('.cc-act-state').getAttribute('data-state').catch(() => null)), { timeout: 10_000 }).toBe('done');
    const back = page.locator('.circle-settings__back, .cc-screen-panel__close').first();
    if (await back.count()) await back.click().catch(() => {});
  };
  await setLists(false);
  await expect(page.locator('.circle-view__tab[data-tab="lists"]'), 'lists off: no tab').toHaveCount(0, { timeout: 15_000 });
  await setLists(true);

  // the tab, after Tasks (when Tasks is there)
  const tab = page.locator('.circle-view__tab[data-tab="lists"]');
  await expect(tab, 'lists on: a Lists tab').toHaveCount(1, { timeout: 15_000 });
  const order = await page.locator('.circle-view__tab').evaluateAll((els) => els.map((e) => e.dataset.tab));
  if (order.includes('tasks')) expect(order.indexOf('lists'), order.join(',')).toBe(order.indexOf('tasks') + 1);
  await tab.click();

  // empty: it says how to make the first one; make one
  await expect(page.locator('.cc-lists-panel__empty')).toBeVisible({ timeout: 10_000 });
  await page.locator('.cc-lists-panel__new-input').fill('Boodschappen');
  await page.locator('.cc-lists-panel__create:not(.cc-lists-panel__create--alt)').first().click();
  const row = page.locator('.cc-lists-panel__list', { hasText: 'Boodschappen' });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // open it and add an entry
  await row.click();
  await page.locator('.circle-container-card__add').first().click();
  await page.locator('.cc-lists-panel__add-input').fill('melk');
  await page.locator('.cc-lists-panel__add-form button[type="submit"]').click();
  await expect(page.locator('.circle-container-card__label', { hasText: 'melk' })).toBeVisible({ timeout: 10_000 });
  expect(errs).toEqual([]);
});
