/**
 * VANDAAG, ON A REAL SCREEN (2026-10-15). The app opens on Vandaag — the home: the person's own first page, seeded
 * once (the coming week, my tasks, the circles with news). "Pas aan" changes it through the screen ops, and the
 * change survives a reload.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const blockTypes = (page) => page.locator('.circle-screen__block').evaluateAll((els) => els.map((e) => e.dataset.blockType));
const blockIds = (page) => page.locator('.circle-screen__block').evaluateAll((els) => els.map((e) => e.dataset.blockId));

test('opens on Vandaag; a block moved in "Pas aan" stays moved after a reload', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head'), 'the app opens on Vandaag').toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tab="screens"]').first()).toBeVisible();
  // the seeded page: the coming week and my tasks (both painted as the cross-circle items block), the circles with news
  await expect.poll(() => blockTypes(page), { timeout: 20_000 }).toEqual(['items', 'items', 'circlesUnread']);
  const [a, b, c] = await blockIds(page);

  // "Pas aan": move the first block down — a screen op (kept, logged, undoable)
  await page.locator('.circle-vandaag__customise').click();
  await page.locator('.vandaag-customise [data-act="down"]').first().click();
  await page.locator('.vandaag-customise [data-act="done"]').click();
  await expect.poll(() => blockIds(page), { timeout: 20_000 }).toEqual([b, a, c]);
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => blockIds(page), { timeout: 20_000 }).toEqual([b, a, c]);
  // …and "Ongedaan maken" puts it back
  await page.locator('.circle-vandaag__customise').click();
  await page.locator('.vandaag-customise [data-act="undo"]').click();
  await page.locator('.vandaag-customise [data-act="done"]').click();
  await expect.poll(() => blockIds(page), { timeout: 20_000 }).toEqual([a, b, c]);
  expect(errs).toEqual([]);
});

test('"meer" opens one block whole, and back returns to the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const when = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(10, 0, 0, 0); return d.toISOString(); });
  const made = await page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'kapper', when: w }), when);
  expect(made?.ok, JSON.stringify(made)).toBe(true);
  await page.locator('[data-tab="circles"]').first().click();
  await page.locator('[data-tab="screens"]').first().click();
  const more = page.locator('.circle-screen__more').first();
  await expect(more).toBeVisible({ timeout: 20_000 });
  await more.click();
  await expect(page.locator('.circle-vandaag__back')).toBeVisible();
  await expect(page.locator('.circle-screen__block')).toHaveCount(1);
  await page.locator('.circle-vandaag__back').click();
  await expect.poll(() => blockTypes(page), { timeout: 20_000 }).toHaveLength(3);
});

test('a notes block added in "Pas aan" takes a labels filter, kept after a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__customise').click();
  await page.locator('.vandaag-customise [data-act="add"]').filter({ hasText: /^(Notities|Notes)$/ }).click();
  const labels = page.locator('.vandaag-customise input[data-control="labels"]');
  await expect(labels).toBeVisible({ timeout: 10_000 });
  await labels.fill('Werk, thuis');
  await labels.blur();
  await expect(page.locator('.vandaag-customise input[data-control="labels"]')).toHaveValue('werk, thuis', { timeout: 10_000 });
  await page.locator('.vandaag-customise [data-act="done"]').click();
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__customise').click();
  await expect(page.locator('.vandaag-customise input[data-control="labels"]')).toHaveValue('werk, thuis');
});
