/**
 * VANDAAG'S ONBOARDING STRIP: the set-up cards (key, connection point, name, "Nieuw bij Basis?") folded into ONE
 * closed strip whose line counts what is left; a tap opens it. Each card goes once done, never a modal and never in
 * the way. No "begin" card: a person in no circle reads one line that points to Circles.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag-onboarding.spec.js
 */
import { test, expect } from '@playwright/test';
import { openOnboardingStrip } from './helpers.js';

test.setTimeout(90_000);

test('the strip: closed, it counts what is left; open, each card goes once done; no circle: one line', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const strip = page.locator('.circle-screen__onb-strip');
  const card = (id) => page.locator(`.circle-screen__onb-card[data-card="${id}"]`);
  await expect(strip, 'a fresh device: the strip, closed').toHaveText(/(things left to set up|dingen om in te stellen)/, { timeout: 20_000 });
  await expect(card('handle'), 'closed: the cards do not show').toBeHidden();
  await expect(card('begin'), 'no begin card: both doors are on Circles').toHaveCount(0);
  await expect(page.locator('.circle-screen__onb-nocircle'), 'in no circle: the one line').toBeVisible();

  await openOnboardingStrip(page);
  await expect(card('handle'), 'open: the handle card').toBeVisible();
  await expect(card('intro')).toBeVisible();
  await card('handle').locator('.circle-screen__onb-handle').fill('anna');
  await card('handle').locator('button[type="submit"]').click();
  await expect(card('handle'), 'a handle set: the card goes').toHaveCount(0, { timeout: 20_000 });

  await card('intro').locator('.circle-screen__onb-btn--ghost').click();   // "Begrepen": the card's text link
  await expect(card('intro'), 'seen: the card goes').toHaveCount(0, { timeout: 20_000 });

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
  await openOnboardingStrip(page);
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
  await openOnboardingStrip(page);
  await expect(key).toBeVisible({ timeout: 20_000 });
  await key.locator('.circle-screen__onb-btn--quiet').click();
  await expect(key, 'later: the card goes for now').toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.cc-mydata-mnemonic__words'), 'and no words were shown').toHaveCount(0);
});
