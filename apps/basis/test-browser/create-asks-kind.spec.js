/**
 * MAKING A CIRCLE ASKS ITS KIND AND ITS PURPOSE (walk rows 14/15/19/33, 2026-11). The first step asks the kind; Next
 * waits for it; the kind's sentence is in the purpose field, where the person sees it and can change it; the review
 * says what was chosen. A street is no longer made a household "Running our home together" without asking.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/create-asks-kind.spec.js
 */
import { test, expect } from '@playwright/test';
import { fillFounderHandle } from './helpers.js';

test('the first step asks the kind; the purpose is the kind\'s sentence, changeable; the review shows both', async ({ page }) => {
  test.setTimeout(120_000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await page.locator('[data-tab="circles"]').first().click();
  await page.locator('.circle-launcher__new').click();
  await page.locator('.cc-wizard-input:visible').first().waitFor({ timeout: 15_000 });
  await page.locator('.cc-wizard-input:visible').nth(0).fill('Straat Test');
  await fillFounderHandle(page, 'anna');

  const next = page.locator('.cc-wizard-btn-primary:visible').first();
  await expect(next, 'no kind yet: Next waits').toBeDisabled();
  await page.locator('input[type="radio"][value="neighbourhood"]:visible').first().check();
  const purpose = page.locator('input[data-field="purpose"], .cc-wizard-field:has-text("Purpose") input, .cc-wizard-field:has-text("Doel") input').first();
  await expect(purpose, 'the kind\'s sentence, in the field').toHaveValue(/neighbourhood|buurt/i, { timeout: 5000 });
  await purpose.fill('Samen de straat schoonhouden');

  await expect(next).toBeEnabled({ timeout: 5000 });
  await next.click();
  const review = page.locator('.cc-wizard-review');
  await expect(review).toBeVisible({ timeout: 10_000 });
  await expect(review).toContainText(/Neighbourhood|Buurt/);
  await expect(review).toContainText('Samen de straat schoonhouden');
  await expect(review).not.toContainText(/Running our home together|Ons huishouden/);
  expect(errs).toEqual([]);
});
