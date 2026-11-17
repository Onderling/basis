/**
 * THE FIRST OPEN, walked cold: a browser that has never opened the app stands on three doors (scan, introduction, just
 * continue); each ends the first open on this device and leads on. Every other spec starts with it answered
 * (playwright.config.js FIRST_OPEN_SEEN); this one empties that.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/first-open.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);
test.use({ storageState: { cookies: [], origins: [] } });

const doors = (page) => page.locator('.circle-first-open__door');
const door = (page, id) => page.locator(`.circle-first-open__door[data-door="${id}"]`);

test('a first open shows the three doors; "just continue" leads to Today, and the doors do not come back', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(doors(page)).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator('.circle-first-open__door').evaluateAll((els) => els.map((e) => e.dataset.door))).resolves.toEqual(['scan', 'intro', 'continue']);
  await expect(page.locator('.circle-vandaag__head'), 'nothing behind the doors yet').toHaveCount(0);
  await door(page, 'continue').click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  // the reminder: Today's "New to Basis?" card stays until the intro is seen
  await expect(page.locator('.circle-screen__onb-card[data-card="intro"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect(doors(page), 'answered once on this device').toHaveCount(0);
  expect(errs).toEqual([]);
});

test('"introduction" opens the seven cards over Today; Today has no intro card afterwards', async ({ page }) => {
  await page.goto('/');
  await door(page, 'intro').click({ timeout: 20_000 });
  await expect(page.locator('.circle-intro')).toHaveAttribute('data-card', 'welcome', { timeout: 20_000 });
  await page.locator('.circle-intro__skip').click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible();
  await expect(page.locator('.circle-screen__onb-card[data-card="intro"]')).toHaveCount(0);
});

test('"scan" leads to Today and runs the one scanner (the scanQr op, as Me\'s Scan does)', async ({ page }) => {
  await page.goto('/');
  await expect(doors(page)).toHaveCount(3, { timeout: 20_000 });
  // no camera in a browser: the one scanner's seam is the paste prompt (the declared web exception), the same as Me → Scan
  const asked = new Promise((resolve) => page.once('dialog', async (d) => { resolve(d.type()); await d.dismiss(); }));
  await door(page, 'scan').click();
  expect(await asked, 'the scanner asked for the code').toBe('prompt');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect(doors(page)).toHaveCount(0);
});
