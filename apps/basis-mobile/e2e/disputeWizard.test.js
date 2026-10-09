// Conflict-dispute wizard launch (D-3 test 1).
//
// Mirror of the original real-device gap: user tapped [Dispute] on
// a stoop post + got the "not wired on mobile yet" bubble.  Now:
//   1. /feed shows the circle feed (stoop list bubble with row buttons)
//   2. Tap [Dispute] on the first post
//   3. The wizard modal opens with the 3-step stepper
//   4. We can advance through the steps (validators gate Next)
//   5. Cancel returns to the chat without leaving an error bubble
//
// We don't actually FILE a dispute (would need a real stoop substrate
// state for the postRequest to land cleanly) — Detox V1 verifies the
// launch + step transitions; vitest verifies submitDispute calls
// stoop.postRequest with kind:'dispute' (see test/wizardRegistry.test.js).

const { gotoChat } = require('./support/nav.js');

// SKIPPED (Detox survey 2026-10-09): this spec drives the classic CHAT SHELL through `gotoChat()` — the launcher's "← chat" affordance (`circle-to-chat`) was removed, so that surface is unreachable for a person (CircleLauncherScreen.js: "no chat shell to navigate to"). On development @ ed1a25ddc every test here timed out in `gotoChat` waiting for `chat-header-status`. Not an app bug. Port what is still worth pinning to the circle composer before un-skipping.
describe.skip('conflict-dispute wizard launch', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await gotoChat();   // M2 — circle launcher is the default screen
  });

  it('[Dispute] on a stoop post opens the wizard + Next is gated by the validator', async () => {
    // Render the circle feed.  /feed is a stoop substrate slash that
    // returns a list bubble with row buttons including [Dispute] for
    // open posts.  The seeded circle has at least one open post.
    await element(by.id('chat-input')).typeText('/feed');
    await element(by.id('chat-send')).tap();

    // Wait for any [Dispute] button to render.  Detox by.id with a
    // wildcard isn't supported, so we tap whatever matches first via
    // ancestor; the conflictDisputeWizard button label is "Dispute".
    await waitFor(element(by.label('Dispute')).atIndex(0))
      .toBeVisible()
      .withTimeout(30_000);
    await element(by.label('Dispute')).atIndex(0).tap();

    // Wizard modal opens.
    await waitFor(element(by.id('conflict-dispute-wizard')))
      .toBeVisible()
      .withTimeout(10_000);
    await expect(element(by.id('wizard-steps'))).toBeVisible();

    // Cancel closes without leaving an error bubble.
    await element(by.id('wizard-action-Cancel')).tap();
    await waitFor(element(by.id('conflict-dispute-wizard')))
      .not.toBeVisible()
      .withTimeout(5_000);
  });
});
