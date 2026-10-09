// logs opens the LogsPanel modal.
//
// The EventLog accumulates events from the booted agent via the
// `publishEvent` callback wired in ChatScreen.  A bare /logs opens
// the panel; the panel renders the per-event rows (or the empty-
// state copy if nothing's been logged yet).
//
// V1 only asserts the modal mounts + dismisses — the event-row
// inventory is timing-dependent (whatever the agent published
// between boot and this test).  Empty-state copy is still inside
// the modal, so the modal mounts either way.

const { gotoChat } = require('./support/nav.js');

// SKIPPED (Detox survey 2026-10-09): this spec drives the classic CHAT SHELL through `gotoChat()` — the launcher's "← chat" affordance (`circle-to-chat`) was removed, so that surface is unreachable for a person (CircleLauncherScreen.js: "no chat shell to navigate to"). On development @ ed1a25ddc every test here timed out in `gotoChat` waiting for `chat-header-status`. Not an app bug. Port what is still worth pinning to the circle composer before un-skipping.
describe.skip('/logs opens the LogsPanel modal', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await gotoChat();   // M2 — circle launcher is the default screen
  });

  it('typing /logs opens the panel + Done dismisses it', async () => {
    await element(by.id('chat-input')).clearText();
    await element(by.id('chat-input')).typeText('/logs');
    await element(by.id('chat-send')).tap();

    await waitFor(element(by.id('logs-panel')))
      .toBeVisible()
      .withTimeout(10_000);

    await element(by.id('logs-panel-close')).tap();
    await waitFor(element(by.id('logs-panel')))
      .not.toBeVisible()
      .withTimeout(5_000);
  });
});
