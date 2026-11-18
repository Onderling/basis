/**
 * THE FIRST OPEN, walked cold: a browser that has never opened the app stands on three doors (scan, introduction, just
 * continue); each ends the first open on this device and leads on. Every other spec starts with it answered
 * (playwright.config.js FIRST_OPEN_SEEN); this one empties that.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/first-open.spec.js
 */
import { test, expect } from '@playwright/test';
import { openOnboardingStrip } from './helpers.js';

test.setTimeout(90_000);
test.use({ storageState: { cookies: [], origins: [] } });

const doors = (page) => page.locator('.circle-first-open__door');
const door = (page, id) => page.locator(`.circle-first-open__door[data-door="${id}"]`);

test('a first open shows the three doors; "just continue" leads to Today, and the doors do not come back', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(doors(page)).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator('.circle-first-open__door').evaluateAll((els) => els.map((e) => e.dataset.door))).resolves.toEqual(['scan', 'intro', 'continue']);
  await expect(page.locator('.circle-vandaag__head'), 'nothing behind the doors yet').toHaveCount(0);
  await door(page, 'continue').click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  // the reminder: Today's "New to Basis?" card stays until the intro is seen
  await openOnboardingStrip(page);
  await expect(page.locator('.circle-screen__onb-card[data-card="intro"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect(doors(page), 'answered once on this device').toHaveCount(0);
  expect(errs).toEqual([]);
});

test('"introduction" opens the seven cards over Today; Today has no intro card afterwards', async ({ page }) => {
  await page.goto('/');
  await door(page, 'intro').click({ timeout: 20_000 });
  await expect(page.locator('.circle-intro')).toHaveAttribute('data-card', 'welcome', { timeout: 20_000 });
  await page.locator('.circle-intro__skip').click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible();
  await expect(page.locator('.circle-screen__onb-card[data-card="intro"]')).toHaveCount(0);
});

test('"scan" leads to Today and runs the one scanner (the scanQr op, as Me\'s Scan does)', async ({ page }) => {
  await page.goto('/');
  await expect(doors(page)).toHaveCount(3, { timeout: 20_000 });
  // no camera in a browser: the one scanner's seam is the paste prompt (the declared web exception), the same as Me → Scan
  const asked = new Promise((resolve) => page.once('dialog', async (d) => { resolve(d.type()); await d.dismiss(); }));
  await door(page, 'scan').click();
  expect(await asked, 'the scanner asked for the code').toBe('prompt');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect(doors(page)).toHaveCount(0);
});

// ── ARRIVING BY A LINK: the link IS the scan door, already answered (firstOpen.js addressCarriesAct) ──────────────
test.describe('a newcomer who arrives by a link is not stopped by the doors', () => {
  test('a contact link in a fresh browser goes straight to the add-contact sheet; no doors, not after a reload either', async ({ page, browser }) => {
    // Anna, who just continued past her own doors, shares her contact link from Mij
    await page.goto('/');
    await door(page, 'continue').click({ timeout: 20_000 });
    await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-tab="mij"]').first().click();
    await page.locator('.cc-profile__share-contact').click();
    const link = await page.locator('.cc-share__link input').inputValue();
    expect(link).toMatch(/#contact=/);
    // a browser that never opened the app opens it
    const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const B = await fresh.newPage();
    await B.goto(`/${link.slice(link.indexOf('#'))}`);
    await expect(B.locator('[data-testid="contact-add-sheet"]'), 'the link\'s own sheet').toBeVisible({ timeout: 30_000 });
    await expect(B.locator('.circle-first-open'), 'no doors before the link').toHaveCount(0);
    await B.goto('/');
    await expect(B.locator('.circle-vandaag__head, .circle-launcher, [data-tab="circles"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(B.locator('.circle-first-open'), 'the first open is answered on this device').toHaveCount(0);
    await fresh.close();
  });

  test('an invitation link in a fresh browser: no doors, not after a reload either', async ({ browser }) => {
    // the doors are under test here, not the join: an invitation the app takes and tries (the admin is not reachable in
    // this project, which has no relay; the join flows are walked by the relay specs)
    const invite = 'onderling-invite://join?c=first-open-walk&a=nobody';
    const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const B = await fresh.newPage();
    await B.goto(`/?join=${encodeURIComponent(invite)}`);
    await B.waitForTimeout(4000);   // the app is up and has taken the link
    await expect(B.locator('.circle-first-open'), 'no doors before the invitation').toHaveCount(0);
    await B.goto('/');
    await B.waitForTimeout(3000);
    await expect(B.locator('.circle-first-open'), 'the first open is answered on this device').toHaveCount(0);
    await fresh.close();
  });
});
