/**
 * VANDAAG'S ONBOARDING STRIP: on a fresh device three cards — your handle, "Nieuw bij Basis?", begin — each gone once it
 * is done, never a modal and never in the way.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag-onboarding.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the strip: three cards, each gone once done', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const card = (id) => page.locator(`.circle-screen__onb-card[data-card="${id}"]`);
  await expect(card('handle'), 'a fresh device: the handle card').toBeVisible({ timeout: 20_000 });
  await expect(card('intro')).toBeVisible();
  await expect(card('begin')).toBeVisible();

  await card('handle').locator('.circle-screen__onb-handle').fill('anna');
  await card('handle').locator('button[type="submit"]').click();
  await expect(card('handle'), 'a handle set: the card goes').toHaveCount(0, { timeout: 20_000 });

  await card('intro').locator('.circle-screen__onb-btn--quiet').click();
  await expect(card('intro'), 'seen: the card goes').toHaveCount(0, { timeout: 20_000 });

  await expect(card('begin'), 'not in a circle yet: begin stays').toBeVisible();
  // the strip is never a modal: the rest of Vandaag is there
  await expect(page.locator('.circle-vandaag__plus')).toBeVisible();
  expect(errs).toEqual([]);
});
