/**
 * A CIRCLE'S "+" OFFERS A PHOTO. The circle's attach menu is built when the circle opens; its sealed-media path
 * resolves a moment later. The menu was never rebuilt when it did, so the file entry ("Bestand") stayed out of the
 * "+" while the composer had the media pipeline all along — no photo could be attached in a circle (2026-10-24).
 * The photo then posts: the composer shows it as a media chip.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/circle-attach-file.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(120_000);

test('the circle "+" offers the file entry, and a picked photo posts', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await bootCircle(page, 'Foto Kring');
  const plus = page.locator('.circle-view__attach').first();
  await expect(plus).toBeVisible({ timeout: 20_000 });
  const fileEntry = page.locator('.circle-view__attach-item[data-op-id="embed-file"]');
  await expect.poll(async () => { if (!(await fileEntry.count())) { await plus.click(); await plus.click(); } return fileEntry.count(); },
    { timeout: 20_000, message: 'the "+" offers the file entry' }).toBeGreaterThan(0);

  // a small PNG: the encoder's input
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 64, 48);
    return Array.from(atob(c.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0));
  }));
  if (await fileEntry.isHidden()) await plus.click();
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  await fileEntry.first().click();
  await (await chooser).setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.circle-view__bubble [class*="media"]').first(), 'the photo posted as a media chip').toBeVisible({ timeout: 30_000 });
  expect(errs).toEqual([]);
});
