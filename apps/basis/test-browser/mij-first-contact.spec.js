/**
 * WHO MAY WRITE TO ME FIRST, chosen on the persona's card (2026-11-14). The person's editor (the header avatar) shows
 * each persona's card with the two choices; the one in force is marked; a tap sets it on that persona, read back through
 * the waist (`agents.getProfileProperties`), and the card then marks the new choice.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/mij-first-contact.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('a persona card offers who may write first; a tap sets it on that persona', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });

  await page.locator('.cc-header-avatar__button').click();
  const on = page.locator('[data-testid="mij-first-contact-default-circleMembersMayWrite-true"]');
  const off = page.locator('[data-testid="mij-first-contact-default-circleMembersMayWrite-false"]');
  await expect(on, 'members may write: on by default').toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect(page.locator('[data-testid="mij-first-contact-default-firstMessages-request"]'), 'a person requests by default')
    .toHaveAttribute('aria-pressed', 'true');

  await off.click();
  await expect(page.locator('[data-testid="mij-first-contact-default-circleMembersMayWrite-false"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  const props = await page.evaluate(async () => (await window.onderlingCall('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? null);
  expect(props?.circleMembersMayWrite, JSON.stringify(props)).toMatchObject({ mode: 'own', value: false });
  expect(errs).toEqual([]);
});
