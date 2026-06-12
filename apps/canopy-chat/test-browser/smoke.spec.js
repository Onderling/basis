/**
 * Playwright smoke test — verifies the scaffold itself works.
 *
 * What it checks:
 *   1. The dev server is reachable
 *   2. The chat shell renders + accepts a slash command
 *   3. /me returns an identity (the most basic smoke for a real
 *      browser bring-up — no signin / no peer-connect needed)
 *
 * What it DOESN'T cover (yet):
 *   - Two-tab cross-peer (see two-tab.spec.js — separate slice)
 *   - File picker (irreducibly human; runbook H-1)
 *
 * This file exists so we can `pnpm exec playwright test` and
 * confirm the harness is wired before writing real browser tests.
 */
import { test, expect } from '@playwright/test';

test('chat shell loads + dispatches /me', async ({ page }) => {
  await page.goto('/classic.html');
  // The chat shell has an input the user types into; selector is
  // best-effort — adjust if the markup changes.  We look for any
  // input that accepts text + the input area's container.
  const input = page.locator('input[type="text"], textarea').first();
  await expect(input).toBeVisible({ timeout: 10_000 });

  // Fire /me and wait for any reply to appear.  We don't assert on
  // exact content (identity changes per run); just that a reply
  // bubble lands.
  await input.fill('/me');
  // The classic shell's command-suggest dropdown (#199) swallows a lone Enter — it accepts the
  // highlighted suggestion instead of submitting. Dismiss it first so the form actually submits.
  await input.press('Escape');
  await input.press('Enter');

  // Wait up to 5s for SOME message text containing 'pubKey' (the
  // /me reply lists pubKey + stableId).
  await expect(page.locator('body')).toContainText(/pubKey/i, { timeout: 5_000 });
});
