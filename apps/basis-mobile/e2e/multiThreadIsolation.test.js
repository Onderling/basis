// Multi-thread message isolation (Phase B D-2 test 2).
//
// Mirrors the Phase A Playwright test of the same name — verifies on
// the real device that:
//   1. A bubble produced in thread A is NOT visible after switching
//      to thread B
//   2. Switching back to A shows the original bubble again
//   3. Bubbles from B are NOT visible in A
//
// Uses free-text inputs as markers — they produce a user-bubble with
// the exact typed text (deterministic) PLUS an "unknown input" bot
// bubble (we don't assert on that).  Free-text was originally `/threads`
// + `/help` slashes but those went live as real host ops under
// Bundle F and the bubble text changed; user-bubbles
// are stable across host-op-routing changes.

const { gotoChat } = require('./support/nav.js');

// SKIPPED (Detox survey 2026-10-09): this spec drives the classic CHAT SHELL through `gotoChat()` — the launcher's "← chat" affordance (`circle-to-chat`) was removed, so that surface is unreachable for a person (CircleLauncherScreen.js: "no chat shell to navigate to"). On development @ ed1a25ddc every test here timed out in `gotoChat` waiting for `chat-header-status`. Not an app bug. Port what is still worth pinning to the circle composer before un-skipping.
describe.skip('multi-thread message isolation', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await gotoChat();   // M2 — circle launcher is the default screen
  });

  it('messages stay in their thread; switching swaps the visible stream', async () => {
    // Marker in seed Main thread.  Free-text "thread-A-marker" lands
    // as a user-bubble verbatim.  `.toExist()` instead of `.toBeVisible()`
    // because RN <View> wrappers can fail the 75%-visible threshold.
    await element(by.id('chat-input')).typeText('thread-A-marker');
    await element(by.id('chat-send')).tap();
    await waitFor(element(by.text('thread-A-marker')))
      .toExist()
      .withTimeout(15_000);

    // Open drawer, create + auto-switch to 'Side'.
    await element(by.id('chat-drawer-open')).tap();
    await waitFor(element(by.id('thread-drawer')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.id('thread-drawer-new-input')).typeText('Side');
    await element(by.id('thread-drawer-new-submit')).tap();
    await waitFor(element(by.id('thread-drawer')))
      .not.toBeVisible()
      .withTimeout(5_000);
    await waitFor(element(by.id('chat-active-thread-name')))
      .toHaveText('Side')
      .withTimeout(5_000);

    // Side starts empty.  Main's marker must NOT be in the view hierarchy.
    await expect(element(by.text('thread-A-marker'))).not.toExist();

    // Different marker in Side.
    await element(by.id('chat-input')).typeText('thread-B-marker');
    await element(by.id('chat-send')).tap();
    await waitFor(element(by.text('thread-B-marker')))
      .toExist()
      .withTimeout(15_000);

    // Switch back to Main; only thread-A-marker should be visible.
    await element(by.id('chat-drawer-open')).tap();
    await waitFor(element(by.id('thread-drawer')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.id('thread-row-main')).tap();
    await waitFor(element(by.id('thread-drawer')))
      .not.toBeVisible()
      .withTimeout(5_000);
    await waitFor(element(by.id('chat-active-thread-name')))
      .toHaveText('Main')
      .withTimeout(5_000);
    await expect(element(by.text('thread-A-marker'))).toExist();
    await expect(element(by.text('thread-B-marker'))).not.toExist();
  });
});
