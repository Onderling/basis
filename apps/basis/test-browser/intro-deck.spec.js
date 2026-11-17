/**
 * THE INTRODUCTION: Today's "New to Basis?" card → "Read more" opens the seven cards, one per screen; "Next" turns
 * the page, the last card's button leaves for Today, "Skip" leaves at once. Either way the card is gone from Today.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/intro-deck.spec.js
 */
import { test, expect } from '@playwright/test';
import { openOnboardingStrip } from './helpers.js';

test.setTimeout(90_000);

const CARDS = ['welcome', 'circles', 'contacts', 'plus', 'selves', 'nearby', 'keys'];
const introCard = (page) => page.locator('.circle-screen__onb-card[data-card="intro"]');

test('"Read more" opens the seven cards in order; the last button leaves for Today and the card is gone', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await openOnboardingStrip(page);
  await introCard(page).locator('.circle-screen__onb-btn').first().click();   // "Lees meer"
  const deck = page.locator('.circle-intro');
  for (const [i, id] of CARDS.entries()) {
    await expect(deck, `card ${i + 1}`).toHaveAttribute('data-card', id);
    await expect(deck.locator('.circle-intro__title')).not.toBeEmpty();
    await expect(deck.locator('.circle-intro__body')).not.toBeEmpty();
    await expect(deck.locator('.circle-intro__skip'), 'Skip under every card but the last').toHaveCount(i === CARDS.length - 1 ? 0 : 1);
    await deck.locator('.circle-intro__next').click();
  }
  await expect(deck, 'the last button leaves the deck').toHaveCount(0);
  await expect(page.locator('.circle-vandaag__head')).toBeVisible();
  await expect(introCard(page), 'the card has gone from Today').toHaveCount(0);
  expect(errs).toEqual([]);
});

test('"Skip" leaves the introduction at once, and the card is gone from Today', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await openOnboardingStrip(page);
  await introCard(page).locator('.circle-screen__onb-btn').first().click();
  await page.locator('.circle-intro__next').click();
  await expect(page.locator('.circle-intro')).toHaveAttribute('data-card', 'circles');
  await page.locator('.circle-intro__skip').click();
  await expect(page.locator('.circle-intro')).toHaveCount(0);
  await expect(introCard(page)).toHaveCount(0);
});

test('a click outside the card leaves the introduction too, and Today is painted again without the card', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await openOnboardingStrip(page);
  await introCard(page).locator('.circle-screen__onb-btn').first().click();
  await expect(page.locator('.circle-intro')).toHaveAttribute('data-card', 'welcome');
  // the overlay itself, outside the card (its top-left corner)
  await page.locator('.cc-mydata-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.circle-intro')).toHaveCount(0);
  await expect(introCard(page), 'Today painted again: the card has gone').toHaveCount(0);
});

test('once seen, the introduction opens again from Settings (its door beside Help)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await openOnboardingStrip(page);
  await introCard(page).locator('.circle-screen__onb-btn--ghost').click();   // "Begrepen": the card is gone for good
  await expect(introCard(page)).toHaveCount(0);
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__door-row--intro').click();
  await expect(page.locator('.circle-intro')).toHaveAttribute('data-card', 'welcome');
});
