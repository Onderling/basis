/**
 * v2 circle app — web e2e (the automated guard for the launcher → create →
 * detail flow that unit tests can't cover, e.g. the create→listMyBuurts
 * integration). The v2 circle app is the default route ('/'); the classic
 * shell lives at '/classic.html'.
 *
 * Run: `npx playwright test circle-v2` (needs the dev server; see
 * playwright.config.js webServer). Agent boot + createGroupV2 round-trip
 * over InternalTransport take a moment, hence the generous timeouts.
 */
import { test, expect } from '@playwright/test';

const LONG = 30_000;

test('launcher renders + "+ new circle" creates a circle that then appears', async ({ page }) => {
  // "+ new circle" prompts for a name via window.prompt.
  page.on('dialog', (d) => d.accept('Test Circle'));

  await page.goto('/');
  // '/' lands on the Stroom (screens) tab; the launcher lives under the Kringen tab.
  await page.locator('[data-tab="kringen"]').click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: LONG });

  await page.locator('.circle-launcher__new').click();

  // createGroupV2 → reload via listMyBuurts → a tile appears. The tile name
  // is the groupId slug today (name enrichment is a later polish).
  await expect(
    page.locator('.circle-tile__name', { hasText: 'test-circle' }),
  ).toBeVisible({ timeout: LONG });
});

test('opening a circle shows its detail and back returns to the launcher', async ({ page }) => {
  page.on('dialog', (d) => d.accept('Detail Circle'));

  await page.goto('/');
  // '/' lands on the Stroom (screens) tab; the launcher lives under the Kringen tab.
  await page.locator('[data-tab="kringen"]').click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: LONG });
  await page.locator('.circle-launcher__new').click();

  const tile = page.locator('.circle-tile').first();
  await expect(tile).toBeVisible({ timeout: LONG });
  await tile.click();

  // SP-13: a tile opens the KRING view (chat IS the kring view); the old action-grid CircleDetail
  // (.circle-detail__*) was replaced as the per-circle landing surface by showKring.
  await expect(page.locator('.circle-kring__title')).toBeVisible({ timeout: LONG });
  await page.locator('.circle-kring__back').click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: LONG });
});
