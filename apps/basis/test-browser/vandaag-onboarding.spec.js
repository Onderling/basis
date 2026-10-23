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

  await card('intro').locator('.circle-screen__onb-btn--ghost').click();   // "Begrepen": the card's text link
  await expect(card('intro'), 'seen: the card goes').toHaveCount(0, { timeout: 20_000 });

  await expect(card('begin'), 'not in a circle yet: begin stays').toBeVisible();
  // the strip is never a modal: the rest of Vandaag is there
  await expect(page.locator('.circle-vandaag__plus')).toBeVisible();
  expect(errs).toEqual([]);
});

test('the key card: the words never show by themselves — "Toon" opens them, "Opgeschreven" ends the card', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const key = page.locator('.circle-screen__onb-card[data-card="key"]');
  await expect(key, 'a fresh device: the key card').toBeVisible({ timeout: 20_000 });
  // nothing on screen holds the phrase until the explicit step
  await expect(page.locator('.cc-mydata-mnemonic__words')).toHaveCount(0);
  await key.locator('.circle-screen__onb-btn').first().click();
  const words = page.locator('.cc-mydata-mnemonic__words');
  await expect(words, '"Toon" opens the words').toBeVisible({ timeout: 20_000 });
  expect((await words.textContent()).trim().split(/\s+/).length).toBe(24);
  await page.locator('[data-testid="mnemonic-written"]').click();
  await expect(words).toHaveCount(0);
  await expect(key, 'written down: the card goes').toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect(key, 'and stays gone').toHaveCount(0);
  expect(errs).toEqual([]);
});

test('the key card: "Later" puts it away', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const key = page.locator('.circle-screen__onb-card[data-card="key"]');
  await expect(key).toBeVisible({ timeout: 20_000 });
  await key.locator('.circle-screen__onb-btn--quiet').click();
  await expect(key, 'later: the card goes for now').toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.cc-mydata-mnemonic__words'), 'and no words were shown').toHaveCount(0);
});
