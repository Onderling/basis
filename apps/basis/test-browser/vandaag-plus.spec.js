/**
 * VANDAAG'S "+", ON A REAL SCREEN (2026-10-15). An own note and an own appointment, made from the "+" beside "Pas aan":
 * each lands in the person's own store and shows on Vandaag tagged as theirs ("jij"/"you") — a page without a notes
 * block gets one, as an ordinary page change.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag-plus.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the "+" makes an own note and an own appointment, both on Vandaag as mine', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head'), 'the app opens on Vandaag').toBeVisible({ timeout: 20_000 });

  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__act[data-act="own-note"]').click();
  await page.locator('.circle-vandaag-plus__body').fill('sleutel bij de buren');
  await page.locator('.circle-vandaag-plus__save').click();
  const noteRow = page.locator('.circle-screen__items-row').filter({ hasText: 'sleutel bij de buren' });
  await expect(noteRow, 'the own note shows on Vandaag').toBeVisible({ timeout: 20_000 });
  await expect(noteRow.locator('.circle-screen__tasks-circle')).toHaveText(/^(jij|you)$/);

  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__act[data-act="own-appointment"]').click();
  await page.locator('.circle-vandaag-plus__title').fill('tandarts');
  const when = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(14, 0, 0, 0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T14:00`; });
  await page.locator('.circle-vandaag-plus__when').fill(when);
  await page.locator('.circle-vandaag-plus__save').click();
  await expect(page.locator('.circle-screen__agenda-row').filter({ hasText: 'tandarts' }), 'the own appointment shows').toBeVisible({ timeout: 20_000 });

  // an empty save says so and makes nothing
  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__act[data-act="own-note"]').click();
  await page.locator('.circle-vandaag-plus__save').click();
  await expect(page.locator('.circle-vandaag-plus__error')).toBeVisible();
  expect(errs).toEqual([]);
});
