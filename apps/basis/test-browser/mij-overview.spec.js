/**
 * MIJN OVERZICHT ON MIJ, ON A REAL SCREEN (2026-10-08). The Schermen tab is hidden again; Mij has ONE section, "Mijn
 * overzicht": Gepland's rows on top (the coming days — a person's own appointment among them), and below them "Mijn
 * dingen", the chores across every circle (a fresh profile always has its Help circle, so there is a circle to walk).
 * No separate Gepland section, no "Mijn agenda" block.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/mij-overview.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('Mij shows Mijn overzicht — Gepland\'s rows, then my things — and there is no Schermen tab', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await page.waitForTimeout(4000);
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible();
  await expect(page.locator('[data-tab="screens"]'), 'the Schermen tab is not painted').toHaveCount(0);

  const when = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(14, 0, 0, 0); return d.toISOString(); });
  const made = await page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'tandarts', when: w }), when);
  expect(made?.ok, JSON.stringify(made)).toBe(true);

  await page.locator('[data-tab="mij"]').first().click();
  const overview = page.locator('.cc-profile__overview');
  await expect(overview).toBeVisible({ timeout: 15_000 });
  await expect(overview.locator('.cc-profile__section-title')).toHaveText(/^(Mijn overzicht|My overview)$/);
  await expect(page.locator('.cc-profile__section-title').filter({ hasText: /^(Gepland|Planned)$/ }), 'no Gepland section of its own').toHaveCount(0);
  await expect(overview.locator('.cc-profile__planned-item').filter({ hasText: 'tandarts' }), 'Gepland\'s rows, inside the overview').toBeVisible({ timeout: 20_000 });
  await expect(overview.locator('[data-block-id="mij-my-things"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(overview.locator('[data-block-id="mij-my-agenda"]')).toHaveCount(0);
  // no screens manager around the block
  await expect(overview.locator('.circle-screen').locator('button, input')).toHaveCount(0);
  expect(errs).toEqual([]);
});
