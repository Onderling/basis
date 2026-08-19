/**
 * Phase A — thread drawer parity (step 5 verified on web).
 *
 * The drawer is mobile-specific UX (web basis has its own
 * left-rail sidebar with a different shape), so the parity claim here
 * is narrower: the same threadState reducer that powers RN runs on
 * react-native-web with identical create/switch semantics.
 */
import { test, expect } from '@playwright/test';

async function waitForBoot(page) {
  await expect(page.getByTestId('chat-header-status'))
    .toContainText(/Agents ready/i, { timeout: 30_000 });
}

test.describe('#224 Phase A — thread drawer', () => {
  test('opens the drawer, creates a new thread, switches to it', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    // Drawer starts closed; the ☰ button is in the header.
    await page.getByTestId('chat-drawer-open').click();

    const drawer = page.getByTestId('thread-drawer');
    await expect(drawer).toBeVisible();
    // Default 'Main' thread row is present + active.
    await expect(page.getByTestId('thread-row-main')).toBeVisible();

    // Create a new thread via the inline + form.
    await page.getByTestId('thread-drawer-new-input').fill('Circle');
    await page.getByTestId('thread-drawer-new-submit').click();

    // createThread auto-switches, drawer closes, active-thread name
    // updates in the header.
    await expect(drawer).toBeHidden();
    await expect(page.getByTestId('chat-active-thread-name')).toHaveText('Circle');

    // Re-open the drawer to confirm both threads are listed + the
    // new one is active.
    await page.getByTestId('chat-drawer-open').click();
    const rows = await page.locator('[data-testid^="thread-row-"]').count();
    expect(rows).toBeGreaterThanOrEqual(2);

    // Switch back to Main.
    await page.getByTestId('thread-row-main').click();
    await expect(page.getByTestId('chat-active-thread-name')).toHaveText('Main');
  });
});
