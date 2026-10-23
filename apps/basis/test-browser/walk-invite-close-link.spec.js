/**
 * THE INVITE has a way out and a link: "Sluiten" closes it (the backdrop was the only way, and nobody should have to
 * know that), and "Stuur de link" sends the invite to someone who is not in the room — the browser's share sheet where
 * it has one, else copied (headless Chromium has none: copied). An admin also invites from Members — the ⋯ menu's own
 * invite act, not a second one.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8788 npx playwright test --project=relay test-browser/walk-invite-close-link.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, gotoCircles, createCircle, openCircleMatching, openMore } from './peerHarness.js';

test.setTimeout(180_000);

test('the invite: send the link, close it; Members invites too', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    await A.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoCircles(A.page);
    await createCircle(A.page, 'Uitnodigkring');
    await openCircleMatching(A.page, /uitnodigkring/i);

    expect(await openMore(A.page, 'invite'), 'the ⋯ menu offers invite').toBeTruthy();
    const modal = A.page.locator('.cc-mydata-modal');
    const code = modal.locator('code');
    await expect(code, 'the invite link').toBeVisible({ timeout: 20_000 });
    const link = (await code.innerText()).trim();
    await modal.locator('[data-testid="invite-send-link"]').click();
    await expect(modal.getByText(/link (copied|gekopieerd)/i), 'no share sheet here: copied, and it says so').toBeVisible({ timeout: 5_000 });
    expect((await A.page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(link);
    await modal.locator('[data-testid="invite-close"]').click();
    await expect(modal, 'Sluiten closes it').toHaveCount(0);

    // Members: the admin's Invite opens the same invite
    await A.page.locator('.circle-view__tab', { hasText: /leden|members/i }).first().click();
    const inv = A.page.locator('.circle-view__members-invite');
    await expect(inv, 'an admin invites from Members').toBeVisible({ timeout: 15_000 });
    await inv.click();
    await expect(A.page.locator('.cc-mydata-modal code')).toBeVisible({ timeout: 20_000 });
    await A.page.locator('[data-testid="invite-close"]').click();
  } finally { await teardown(peers); }
});
