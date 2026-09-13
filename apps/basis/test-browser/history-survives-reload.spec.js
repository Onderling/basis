/**
 * WHAT YOU SAID IS STILL THERE AFTER A RELOAD.
 *
 * The smallest test that would have caught the regression of 2026-09-10, and the reason the browser
 * suite is a launch item: when the device log became sealed at rest, both shells kept hydrating it before
 * the content key existed. The read got a sealed envelope, the loader threw, and `wireEventLogPersistence`
 * caught the throw and started EMPTY — correctly, for a corrupt snapshot; silently, for one that was
 * merely locked. Every reload came up with no history at all, behind one console warning. Seven vitest
 * suites and CI were green throughout, because the device log's hydration order is a property of how a
 * SHELL composes the agent, and nothing but a real page load exercises that.
 *
 * So: send a message, reload the page the way a person does, and insist the message is still there. Not
 * logged as an observation — asserted. This spec exists to go red.
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(120_000);

test('a message sent before a reload is still in the conversation after it', async ({ page }) => {
  await bootCircle(page, 'Reload Circle');
  const marker = `vóór-de-reload-${Date.now().toString(36)}`;

  const input = page.locator('.circle-view__composer-input');
  await input.fill(marker);
  await input.press('Enter');
  await expect(page.locator('.circle-view__bubble', { hasText: marker }),
    'the message never rendered — the reload half would be vacuous').toBeVisible({ timeout: 15_000 });
  // Past the device log's persist debounce, so what is on disk is what we are about to reload.
  await page.waitForTimeout(1500);

  // ── The person reloads. Everything in memory is gone; only the disk remains. ──────────────────
  await page.reload();
  await page.locator('[data-tab="circles"]').click();
  await page.locator('.circle-tile', { hasText: 'Reload Circle' }).first().click();
  await page.waitForTimeout(2500);
  const chatPill = page.locator('.circle-view__view-toggle-btn', { hasText: 'Chat' });
  if (await chatPill.count()) await chatPill.click();

  await expect(page.locator('.circle-view__bubble', { hasText: marker }),
    'the conversation came back EMPTY after a reload — the device log was written but could not be read back')
    .toBeVisible({ timeout: 20_000 });
});
