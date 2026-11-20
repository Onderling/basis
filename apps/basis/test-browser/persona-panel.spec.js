/**
 * MIJ LEAVES THE TAB BAR, ON A REAL SCREEN (2026-11-20). The bar is Vandaag · Kringen · + · Contacten; the persona
 * button opens the persona panel over the tab that is showing (the short view, closed by a touch outside or its close);
 * the settings button beside it opens the settings home, whose back names the tab it returns to; the persona button is
 * ringed in the availability's colour and its label names it; the panel's availability row opens the availability
 * screen. Vandaag shows no availability at all.
 *
 *   npx playwright test --project=no-relay test-browser/persona-panel.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the persona panel opens over the tab; the settings button comes back to that tab; Vandaag holds the availability', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const bar = await page.locator('.circle-tabbar > button').evaluateAll((els) => els.map((b) => b.dataset.tab ?? '+'));
  expect(bar, 'no Mij in the bar').toEqual(['screens', 'circles', '+', 'contacten']);

  // the panel over Contacten: the short view, and the tab stays what it was
  await page.locator('[data-tab="contacten"]').first().click();
  await page.locator('.cc-persona-button__button').click();
  const panel = page.locator('.cc-persona-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-block-type="identityLine"] .cc-profile__title')).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('.cc-profile__share-contact'), 'Deel mijn kaart').toBeVisible();
  await expect(panel.locator('.cc-profile__scan'), 'Scan is in the "+" only').toHaveCount(0);
  await expect(panel.locator('.cc-profile__gear'), 'no settings door in the panel').toHaveCount(0);
  await expect(panel.locator('.cc-persona-panel__tab'), 'one persona: no tabs').toHaveCount(0);
  await page.mouse.click(5, 5);   // a touch outside closes it
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-tab="contacten"]')).toHaveClass(/is-active/);

  // the settings button from Contacten: its back says Contacten and goes there
  await page.locator('.cc-persona-button__settings').click();
  await expect(page.locator('.cc-settings__group--appearance')).toBeVisible({ timeout: 15_000 });
  const back = page.locator('.cc-mydata__back').first();
  await expect(back).toHaveText(/Contacten|Contacts/);
  await back.click();
  await expect(page.locator('[data-tab="contacten"]')).toHaveClass(/is-active/, { timeout: 15_000 });

  // the availability left Vandaag: a ring on the persona button (its label names the state), the row in the panel
  await page.locator('[data-tab="screens"]').first().click();
  await expect(page.locator('.circle-vandaag__day')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-vandaag__availability, .circle-screen__block--availability'), 'nothing of it on Vandaag').toHaveCount(0);
  const button = page.locator('.cc-persona-button__button');
  // this project runs without a relay: available, but not connected (the grey ring); the label says so in words
  await expect(button).toHaveAttribute('data-availability', 'offline');
  await expect(button).toHaveAttribute('aria-label', /Persona, /);
  await page.locator('.cc-persona-button').screenshot({ path: 'test-results/persona-button-ring.png' });
  await button.click();
  const words = page.locator('.cc-persona-panel__availability');
  await expect(words, 'the availability row in the panel').toHaveText(/·/, { timeout: 15_000 });
  await words.click();
  await expect(page.locator('.circle-availability__title')).toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});
