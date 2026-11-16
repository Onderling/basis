/**
 * HELP READS A QUESTION IN EITHER LANGUAGE, ON A REAL SCREEN (walk row 81: "hoe maak ik een kring?" in an app set to
 * English got ~30 English topic buttons). The help conversation answers the Dutch question with its card, in the app's
 * language, and no topic list.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/help-any-language.spec.js
 */
import { test, expect } from '@playwright/test';
import { helpDeck } from '../src/v2/help/kaartjes.js';

test.setTimeout(90_000);
// an app in ENGLISH, asked in Dutch: the case the walk found
test.use({ locale: 'en-US' });

const card = helpDeck.kaartjes.find((k) => k.id === 'werking.kringen');
const firstWords = (s) => String(s).split(/\s+/).slice(0, 6).join(' ');

test('"hoe maak ik een kring?" is answered with the make-a-circle card, whatever the app language', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(async () => ((await window.onderlingCall('pinboard', 'listMyCircles', {}))?.circles ?? [])
    .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).includes('cc-help')), { timeout: 20_000 }).toBe(true);
  await page.locator('[data-tab="contacten"]').first().click();
  await page.locator('.cc-contacts__row[data-synthetic="true"]').click();
  await expect(page.locator('.circle-view__title')).toContainText(/Uitleg|Help/, { timeout: 20_000 });

  const input = page.locator('.circle-view__composer-input');
  await input.fill('hoe maak ik een kring?');
  await input.press('Enter');
  // the card, in the app's language (either one): never the "only these set topics" list
  const answer = page.locator('.circle-view__bubble').filter({ hasText: firstWords(card.en) });
  await expect(answer.first(), 'the make-a-circle card answered').toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});

