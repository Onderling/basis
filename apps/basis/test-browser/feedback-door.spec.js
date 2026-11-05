/**
 * THE FEEDBACK DOOR, ON A REAL SCREEN (2026-10-24). With the build's feedback card (VITE_SEEDED_CONTACT_CARD) the
 * contact is OFFERED, never seeded (2026-11-05): a boot adds nobody; the first time the person reaches the door they are
 * asked — one line saying who receives what — and their yes adds it. Instellingen → "Feedback geven", the "+" sheet's act
 * and `/feedback` typed in a circle each open THAT thread with "[<screen> · <version>] " in the composer — sent by nobody
 * but the person. `/feedback` in a circle posts nothing to the circle.
 *
 *   VITE_SEEDED_CONTACT_CARD=<card> PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/feedback-door.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(120_000);
const WITH_CARD = Boolean(process.env.VITE_SEEDED_CONTACT_CARD);

/** the door's offer, answered yes: the person adds the Feedback contact with their own tap */
const acceptOffer = (page) => page.on('dialog', (d) => { if (/Feedback/.test(d.message())) d.accept().catch(() => {}); else d.dismiss().catch(() => {}); });
const composer = (page) => page.locator('.cc-cthread__composer input, .cc-cthread__composer textarea').first();

test('Instellingen → Feedback geven opens the thread, prefilled', async ({ page }) => {
  test.skip(!WITH_CARD, 'a build with a feedback card (VITE_SEEDED_CONTACT_CARD)');
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  acceptOffer(page);
  await page.locator('.cc-settings__door-row--feedback').click();
  await expect(composer(page)).toHaveValue(/^\[instellingen · .+\] $/, { timeout: 20_000 });
  // the thread is the feedback contact's (its card names it: the Feedback persona; an older card named the maker)
  await expect(composer(page)).toHaveAttribute('placeholder', /Feedback|onderling-feedback|Onderling/);
});

test('/feedback in a circle opens the thread, names no circle, and posts nothing to the circle', async ({ page }) => {
  test.skip(!WITH_CARD, 'a build with a feedback card (VITE_SEEDED_CONTACT_CARD)');
  await bootCircle(page, 'Huize Zwartkruid-7731');
  const before = await page.locator('.circle-view__bubble').count();
  acceptOffer(page);
  await page.locator('.circle-view__composer-input').fill('/feedback');
  await page.locator('.circle-view__composer-send').click();
  // the KIND of screen only: the draft goes to the maker's contact, and the circle's name is the person's own
  await expect(composer(page)).toHaveValue(/^\[circle · .+\] $/, { timeout: 20_000 });
  expect(await composer(page).inputValue()).not.toContain('Zwartkruid');
  // back in the circle: no line was posted there
  await page.goBack().catch(() => {});
  await page.goto('/');
  await page.locator('[data-tab="circles"]').first().click();
  await page.locator('.circle-tile', { hasText: 'Huize Zwartkruid-7731' }).first().click();
  await expect(page.locator('.circle-view__bubble', { hasText: '/feedback' })).toHaveCount(0);
  expect(await page.locator('.circle-view__bubble').count()).toBeLessThanOrEqual(before);
});

test('the "+" sheet\'s act opens the thread at once', async ({ page }) => {
  test.skip(!WITH_CARD, 'a build with a feedback card (VITE_SEEDED_CONTACT_CARD)');
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await page.locator('.circle-vandaag__plus').click();
  acceptOffer(page);
  await page.locator('.circle-vandaag-plus__act[data-act="basis.feedback"]').click();
  await expect(composer(page)).toHaveValue(/^\[.+ · .+\] $/, { timeout: 20_000 });
});

test('a build WITHOUT a card: the door stays and says so, honestly', async ({ page }) => {
  test.skip(WITH_CARD, 'the build carries a card');
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  let said = null;
  page.once('dialog', (d) => { said = d.message(); d.dismiss().catch(() => {}); });
  await page.locator('.cc-settings__door-row--feedback').click();
  await expect.poll(() => said, { timeout: 20_000, message: 'the door said something' }).toMatch(/feedback/i);
  await expect(page.locator('.cc-settings__door-row--feedback'), 'the door stays').toBeVisible();
});

test('offered, never seeded: a boot and a reload add nobody; a no adds nothing; a yes adds it', async ({ page }) => {
  test.skip(!WITH_CARD, 'a build with a feedback card (VITE_SEEDED_CONTACT_CARD)');
  const inBook = () => page.evaluate(async () => {
    const r = await window.onderlingCall('pinboard', 'listContacts', {});
    const rows = r?.items ?? r?.contacts ?? [];
    return rows.some((c) => /Feedback/.test(String(c?.handle ?? c?.displayName ?? '')));
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await page.waitForTimeout(4000);   // past the boot's own work, where the card used to be added
  expect(await inBook(), 'a fresh boot added the Feedback contact on its own').toBe(false);
  await page.reload();
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await page.waitForTimeout(4000);
  expect(await inBook(), 'a reload added the Feedback contact on its own').toBe(false);
  // the door asks; no → nothing added, nothing opened
  let said = null;
  page.once('dialog', (d) => { said = d.message(); d.dismiss().catch(() => {}); });
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__door-row--feedback').click();
  await expect.poll(() => said, { timeout: 20_000, message: 'the door did not ask first' }).toMatch(/Feedback/);
  expect(said, 'the offer says who receives what').toMatch(/contact card|contactkaart/);
  expect(await inBook(), 'a no added the contact anyway').toBe(false);
  // yes → added, and the thread opens prefilled
  acceptOffer(page);
  await page.locator('.cc-settings__door-row--feedback').click();
  await expect(composer(page)).toHaveValue(/^\[instellingen · .+\] $/, { timeout: 20_000 });
  expect(await inBook(), 'the yes did not add the contact').toBe(true);
});

