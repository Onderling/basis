/**
 * MIJ = IDENTITY, ON A REAL SCREEN (2026-10-15; the persona panel since 2026-11-20). One declared short view: the
 * person's name as the title, "Deel mijn kaart", "My devices and helpers" (this device listed) — and no section
 * listed by hand. "Edit" opens the person's own editor with the
 * handle and the location on top; the doors Mij gave up have their own homes.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/mij-identity.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the persona panel shows the name and the devices; Edit and the settings button hold the rest (the moved doors have their own homes)', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await page.waitForTimeout(4000);
  await expect(page.locator('.cc-persona-button__button')).toBeVisible();

  const when = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(14, 0, 0, 0); return d.toISOString(); });
  const made = await page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'tandarts', when: w }), when);
  expect(made?.ok, JSON.stringify(made)).toBe(true);

  await page.locator('.cc-persona-button__button').click();
  await expect(page.locator('[data-block-type="identityLine"] .cc-profile__title')).toBeVisible({ timeout: 20_000 });
  // no readings any more: what is about now is on Vandaag (availability, "Wacht op jou"); the counts were dropped
  await expect(page.locator('.circle-screen__identity-readings')).toHaveCount(0);
  await expect(page.locator('.circle-screen__agents-row[data-kind="device"]').first(), 'this device is listed').toBeVisible();
  await expect(page.locator('.cc-profile__share-contact')).toBeVisible();
  await expect(page.locator('.cc-profile__section'), 'no section listed by hand').toHaveCount(0);

  await page.locator('.circle-screen__identity-edit').click();
  await expect(page.locator('.cc-screen-panel .cc-profile__handle'), 'the handle is in the person\'s own editor').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-screen-panel .cc-profile__geo-input')).toBeVisible();
  await page.locator('.cc-screen-panel__close').click();

  // the doors Mij gave up have their own homes: availability on Vandaag and in Verbinding, shared-with-me a chip on
  // Vandaag, blocked at the foot of Contacten, the log report in Mijn gegevens; the persona panel has no settings door —
  // the settings button beside the persona button is the one way in
  await expect(page.locator('.cc-profile__mydata')).toHaveCount(0);
  await expect(page.locator('.cc-persona-panel'), '"Aanpassen" closed the panel: the editor is its own sheet').toHaveCount(0);
  await page.locator('.cc-persona-button__settings').click();
  await page.locator('.cc-settings__group--my-data').click();
  await expect(page.locator('.cc-settings__door--log-report')).toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});

test('"Wacht op jou" left the persona panel for Vandaag, where it shows only when something waits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-screen__block--awaiting'), 'a fresh profile: nothing waits, no block').toHaveCount(0);
  await page.locator('.cc-persona-button__button').click();
  await expect(page.locator('.cc-persona-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cc-persona-panel .circle-screen__block--awaiting'), 'not on the panel').toHaveCount(0);
});
