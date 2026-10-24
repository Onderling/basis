/**
 * MIJ = IDENTITY, ON A REAL SCREEN (2026-10-15). Mij is one declared screen: the person's name as the title with the
 * readings under it (the next appointment among them), the Me actions, "My devices and helpers" (this device listed),
 * the gear to the person's settings — and no section listed by hand. "Edit" opens the person's own editor with the
 * handle and the location on top; the doors Mij gave up have their own homes.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/mij-identity.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('Mij shows the name, its readings and the devices; Edit and the gear hold the rest (the moved doors have their own homes)', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await page.waitForTimeout(4000);
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible();

  const when = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(14, 0, 0, 0); return d.toISOString(); });
  const made = await page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'tandarts', when: w }), when);
  expect(made?.ok, JSON.stringify(made)).toBe(true);

  await page.locator('[data-tab="mij"]').first().click();
  await expect(page.locator('[data-block-type="identityLine"] .cc-profile__title')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-screen__identity-readings'), 'the next appointment is a reading').toContainText('tandarts', { timeout: 20_000 });
  await expect(page.locator('.circle-screen__agents-row[data-kind="device"]').first(), 'this device is listed').toBeVisible();
  await expect(page.locator('.cc-profile__share-contact')).toBeVisible();
  await expect(page.locator('.cc-profile__section'), 'no section listed by hand').toHaveCount(0);

  await page.locator('.circle-screen__identity-edit').click();
  await expect(page.locator('.cc-screen-panel .cc-profile__handle'), 'the handle is in the person\'s own editor').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-screen-panel .cc-profile__geo-input')).toBeVisible();
  await page.locator('.cc-screen-panel__close').click();

  // the doors Mij gave up have their own homes since the settings regroup: availability under the gear (Verbinding),
  // shared-with-me a chip on Mij, blocked at the foot of Contacten, the log report in Mijn gegevens; Mij has no door to an
  // old My data page — the gear is the one way into the settings
  await expect(page.locator('.cc-profile__mydata')).toHaveCount(0);
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__group--my-data').click();
  await expect(page.locator('.cc-settings__door--log-report')).toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});

test('Mij shows what is waiting for you — on a fresh profile, one quiet line', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-tab="mij"]').first().click();
  await expect(page.locator('.circle-screen__block--awaiting'), 'the block is on Mij').toHaveCount(1);
  await expect(page.locator('.circle-screen__block--awaiting')).toHaveText(/Waiting for you — nothing|Wacht op jou — niets/);
});
