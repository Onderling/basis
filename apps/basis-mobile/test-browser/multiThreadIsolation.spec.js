/**
 * Phase A — per-thread message isolation (step 5 invariant).
 *
 * Pins the reducer behaviour that 17 vitest tests already cover, but
 * end-to-end through the real React render path on react-native-web:
 * a bubble produced in thread A must NOT leak into thread B's view
 * when the user switches.
 *
 * Uses free-text inputs (`thread-A-marker`, `thread-B-marker`)
 * because user-bubble text is stable across host-op routing changes
 * — the original /threads + /help slashes went live as real host
 * ops under Bundle F, which would have changed the bot-bubble
 * text.  User-bubbles are routing-agnostic.
 */
import { test, expect } from '@playwright/test';

async function waitForBoot(page) {
  await expect(page.getByTestId('chat-header-status'))
    .toContainText(/Agents ready/i, { timeout: 30_000 });
}

async function sendInput(page, text) {
  const input = page.getByTestId('chat-input');
  await input.fill(text);
  await input.press('Enter');
}

test.describe('#224 Phase A — multi-thread message isolation', () => {
  test('messages stay in their thread; switching swaps the visible stream', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    // Marker in seed 'Main' thread.
    await sendInput(page, 'thread-A-marker');
    await expect(page.locator('body'))
      .toContainText('thread-A-marker', { timeout: 10_000 });

    // Spawn second thread.  createThread auto-switches.  Wait for the
    // drawer modal to fully hide before next interaction — otherwise
    // the modal-hide reflow eats partial keystrokes.
    await page.getByTestId('chat-drawer-open').click();
    await page.getByTestId('thread-drawer-new-input').fill('Side');
    await page.getByTestId('thread-drawer-new-submit').click();
    await expect(page.getByTestId('thread-drawer')).toBeHidden();
    await expect(page.getByTestId('chat-active-thread-name')).toHaveText('Side');

    // Side starts empty.  Main's marker must not be in the view.
    await expect(page.locator('body')).toContainText(/No messages yet/i);
    await expect(page.locator('body')).not.toContainText('thread-A-marker');

    // Different marker in Side.
    await sendInput(page, 'thread-B-marker');
    await expect(page.locator('body'))
      .toContainText('thread-B-marker', { timeout: 10_000 });

    // Switch back to Main; only thread-A-marker.
    await page.getByTestId('chat-drawer-open').click();
    await page.getByTestId('thread-row-main').click();
    await expect(page.getByTestId('thread-drawer')).toBeHidden();
    await expect(page.getByTestId('chat-active-thread-name')).toHaveText('Main');
    await expect(page.locator('body')).toContainText('thread-A-marker');
    await expect(page.locator('body')).not.toContainText('thread-B-marker');

    // Switch to Side; only thread-B-marker.
    await page.getByTestId('chat-drawer-open').click();
    const sideRow = page.locator('[data-testid^="thread-row-"]')
      .filter({ hasText: 'Side' }).first();
    await sideRow.click();
    await expect(page.getByTestId('thread-drawer')).toBeHidden();
    await expect(page.getByTestId('chat-active-thread-name')).toHaveText('Side');
    await expect(page.locator('body')).toContainText('thread-B-marker');
    await expect(page.locator('body')).not.toContainText('thread-A-marker');
  });
});
