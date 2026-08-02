/**
 * v2 circle app — web e2e (the automated guard for the launcher → create →
 * detail flow that unit tests can't cover, e.g. the create→listMyBuurts
 * integration). The v2 circle app is the only route ('/') — the classic shell was removed 2026-06-29.
 *
 * Run: `npx playwright test circle-v2` (needs the dev server; see
 * playwright.config.js webServer). Agent boot + createGroupV2 round-trip
 * over InternalTransport take a moment, hence the generous timeouts.
 */
import { test, expect } from '@playwright/test';
// Circle creation is a five-step WIZARD now, not a `window.prompt` — the dialog handlers these
// tests used accepted a prompt that is never raised, so no circle was ever created.
import { createCircleViaWizard, circleSlug } from './helpers.js';

const LONG = 30_000;

test('launcher renders + "+ new circle" creates a circle that then appears', async ({ page }) => {

  await page.goto('/');
  // '/' lands on the Stroom (screens) tab; the launcher lives under the Kringen tab.
  await page.locator('[data-tab="kringen"]').click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: LONG });

  await createCircleViaWizard(page, 'Test Circle');

  // createGroupV2 → reload via listMyBuurts → a tile appears. The tile name
  // is the groupId slug today (name enrichment is a later polish).
  await expect(
    page.locator('.circle-tile__name', { hasText: 'test-circle' }),
  ).toBeVisible({ timeout: LONG });
});

test('opening a circle shows its detail and back returns to the launcher', async ({ page }) => {

  await page.goto('/');
  // '/' lands on the Stroom (screens) tab; the launcher lives under the Kringen tab.
  await page.locator('[data-tab="kringen"]').click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: LONG });
  await createCircleViaWizard(page, 'Detail Circle');

  const tile = page.locator('.circle-tile').first();
  await expect(tile).toBeVisible({ timeout: LONG });
  await tile.click();

  // a tile opens the KRING view (chat IS the kring view); the old action-grid CircleDetail
  // (.circle-detail__*) was replaced as the per-circle landing surface by showKring.
  await expect(page.locator('.circle-kring__title')).toBeVisible({ timeout: LONG });
  await page.locator('.circle-kring__back').click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: LONG });
});

// G16 + §2 — the real LEDEN (members) tab renders the trail-roster as tappable rows,
// and a tap opens the member card (your own row → the self-view). Guards the wiring
// added in Phase-4 Wave A2. A single-account circle has exactly the creator as a
// member, so its own row is the "jij"-badged self row → tapping it is the self-view path.
test('LEDEN tab renders member rows and a tap opens the member card / self-view', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await page.locator('[data-tab="kringen"]').click();
  await expect(page.locator('.circle-launcher__title')).toBeVisible({ timeout: LONG });
  await createCircleViaWizard(page, 'Leden Circle');

  const tile = page.locator('.circle-tile').first();
  await expect(tile).toBeVisible({ timeout: LONG });
  await tile.click();
  await expect(page.locator('.circle-kring__title')).toBeVisible({ timeout: LONG });

  // A fresh circle lands in scherm-mode (default view='screen'), which hides the
  // per-kring tab bar — flip to Chat so the bottom tabs (incl. LEDEN) render.
  await page.locator('.circle-kring__view-toggle-btn[data-view-mode="chat"]').click();

  // Switch to the LEDEN tab (memberDirectory is on by default → the tab is present).
  const ledenTab = page.locator('.circle-kring__tab', { hasText: /leden|member/i });
  await expect(ledenTab).toBeVisible({ timeout: LONG });
  await ledenTab.click();

  // The real tab body renders (not the tab-coming placeholder).
  await expect(page.locator('.circle-kring__leden')).toBeVisible({ timeout: LONG });
  expect(await page.locator('.circle-kring__placeholder').count()).toBe(0);

  // The creator's own row appears + is badged, and tapping it opens the self-view card.
  const selfRow = page.locator('.circle-kring__member--self');
  await expect(selfRow).toBeVisible({ timeout: LONG });
  await expect(page.locator('.circle-kring__member-you')).toBeVisible();
  await selfRow.click();
  await expect(page.locator('.circle-membercard--self')).toBeVisible({ timeout: LONG });
  // the self-view offers the viewer picker (stranger / agent at minimum).
  await expect(page.locator('.circle-membercard__viewer').first()).toBeVisible();

  // back returns to the kring view.
  await page.locator('.circle-membercard__back').click();
  await expect(page.locator('.circle-kring__title')).toBeVisible({ timeout: LONG });

  expect(pageErrors, `no page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
