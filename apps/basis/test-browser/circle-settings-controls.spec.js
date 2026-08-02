import { test, expect } from '@playwright/test';
import { bootKring } from './helpers.js';

/**
 * Phase 4 Wave A3 — settings-surface controls (§9) + composer slash dispatch (G17), web e2e.
 *
 * Verifies in a real browser what the unit/DOM tests can't reach end-to-end:
 *  1. `/settings` typed in the kring composer dispatches as a BUILT-IN (G17) — it opens the
 *     settings panel instead of routing to the bot.
 *  2. The panel renders the new Connection & transport controls (transport-mode · relay endpoint ·
 *     private-DM) from the manifest.
 *  3. The incompatible control greys out: a fresh circle is pod-mediated with no relay in the
 *     default (no-relay) project, so the §7 route × capability rule DISABLES the member↔member
 *     private-chat toggle (and the relay/both transport options).
 * Zero page errors throughout.
 */
test.setTimeout(70_000);
const LONG = 30_000;

async function openKringComposer(page, name) {
  // Delegates to the ONE shared boot (test-browser/helpers.js). Six specs each carried a copy of
  // this, and all six broke the same way when the product changed twice underneath them.
  await bootKring(page, name);
}

test('/settings (G17 built-in) opens the settings panel with the Connection controls; private-DM greys out under pod-only', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));

  await openKringComposer(page, 'A3 Settings Circle');

  // G17 — `/settings` dispatches as a built-in: it opens the settings panel (showSettings) rather
  // than routing to the bot. Had it gone to the bot, the kring view would stay and a bubble would
  // appear instead of the settings surface.
  await page.locator('.circle-kring__composer-input').fill('/settings');
  await page.locator('.circle-kring__composer-send').click();

  // The settings panel replaces the kring view (the built-in path showSettings).
  await expect(page.locator('.circle-settings')).toBeVisible({ timeout: LONG });
  await expect(page.locator('.circle-kring__composer-input')).toHaveCount(0);   // the kring composer is gone → we're in the panel, not chat

  // §9 — the manifest-declared Connection & transport controls render.
  const connection = page.locator('.circle-settings__connection');
  await expect(connection).toBeVisible({ timeout: LONG });
  await expect(connection.locator('[data-control="transport-mode"]')).toBeVisible();
  await expect(connection.locator('[data-control="relay-endpoint"]')).toBeVisible();
  const privateDm = connection.locator('[data-control="private-dm"]');
  await expect(privateDm).toBeVisible();

  // §7 route × capability — no relay in this project ⇒ the private-DM toggle is DISABLED,
  // and the relay/both transport options are disabled while NKN stays available.
  await expect(privateDm).toHaveAttribute('data-disabled', 'true');
  await expect(privateDm.locator('input[type="checkbox"]')).toBeDisabled();
  await expect(connection.locator('input[name="ctl-transport-mode"][value="relay"]')).toBeDisabled();
  await expect(connection.locator('input[name="ctl-transport-mode"][value="both"]')).toBeDisabled();
  await expect(connection.locator('input[name="ctl-transport-mode"][value="nkn"]')).toBeEnabled();

  expect(errs).toEqual([]);
});
