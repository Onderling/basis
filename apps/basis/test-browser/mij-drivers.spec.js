/**
 * THE DRIVERS EDITOR, ON A REAL SCREEN (2026-10-24). The person's own editor (Mij → Edit) shows their drivers in three
 * sections — Aanbod · Interesses · Doelen. A goal is added with its words and tags and taken off again with its ×; an
 * interest is added as a tag. Each change is read back from the profile (the editor redraws from it).
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/mij-drivers.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('a goal is added and taken off, an interest added — each read back from the profile', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.circle-screen__identity-edit').click();
  await expect(page.locator('.cc-mij__row--drivers')).toHaveCount(3, { timeout: 20_000 });

  await page.locator('.cc-mij__add--goals').click();
  const form = page.locator('.cc-mij__form--goals');
  await form.locator('.cc-mij__input').nth(0).fill('leren zeilen');
  await form.locator('.cc-mij__input').nth(1).fill('zeilen, water');
  await form.locator('.cc-btn--primary').click();
  const goal = page.locator('.cc-mij__row--goals .cc-mij__chip', { hasText: 'leren zeilen' });
  await expect(goal).toHaveCount(1, { timeout: 15_000 });

  const interest = page.locator('.cc-mij__form--interests');
  await interest.locator('.cc-mij__input').fill('Tuinieren');
  await interest.locator('.cc-btn--primary').click();
  await expect(page.locator('.cc-mij__row--interests .cc-mij__chip', { hasText: 'tuinieren' })).toHaveCount(1, { timeout: 15_000 });

  await goal.locator('.cc-mij__chip-remove').click();
  await expect(page.locator('.cc-mij__row--goals .cc-mij__chip', { hasText: 'leren zeilen' })).toHaveCount(0, { timeout: 15_000 });
  const drivers = await page.evaluate(async () => Object.keys((await window.onderlingCall('agents', 'getProfileDrivers', { id: 'default' }))?.drivers ?? {}));
  expect(drivers).toContain('interests');
  expect(drivers.some((k) => k.startsWith('goal:'))).toBe(false);
  expect(errs).toEqual([]);
});
