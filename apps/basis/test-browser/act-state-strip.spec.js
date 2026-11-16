/**
 * SAVE SAYS WHAT HAPPENED — the shared act strip (sitting Part 2 §4, ledger L716).
 *
 * The two-phone walk: a circle's settings Save said nothing. One strip now paints every act the person just took:
 * pending (after a short delay), done, failed. Single context, no relay: open a circle's settings, change a switch,
 * Save — the strip reads "done" — and a read (a tab change) paints nothing.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/act-state-strip.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test('a settings Save paints done on the act strip; a tab change paints nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await bootCircle(page, 'Strip Circle');

  // a read: the Members tab — no act, no strip
  await page.locator('.circle-view__more').click();
  await page.locator('.circle-view__more-item[data-action="settings"]').click();
  await page.waitForTimeout(800);
  expect(await page.locator('.cc-act-state').count(), 'opening settings is a read: nothing on the strip').toBe(0);

  // an act: toggle one switch and Save
  const box = page.locator('input[data-feature="tasks"]');
  await expect(box).toBeVisible({ timeout: 5000 });
  if (await box.isChecked()) await box.uncheck(); else await box.check();
  await page.locator('.circle-settings__save').click();
  const strip = page.locator('.cc-act-state');
  await expect(strip, 'Save says what happened').toBeVisible({ timeout: 5000 });
  const state = await strip.getAttribute('data-state');
  expect(['pending', 'done'], `an honest state, not "${state}"`).toContain(state);
  await expect.poll(() => strip.getAttribute('data-state').catch(() => null), { timeout: 10_000 }).toBe('done');
  const text = await strip.innerText();
  expect(text.trim().length, 'the strip has words, not a key').toBeGreaterThan(0);
  expect(text, 'no key on the strip').not.toMatch(/[A-Za-z0-9_-]{28,}/);

  // …and it clears by itself
  await expect(strip).toHaveCount(0, { timeout: 8000 });
});
