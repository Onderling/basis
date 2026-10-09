// Restart survival (D-1 test 3).
//
// Replaces the manual restart check:
//   1. Boot the app, identity gets provisioned + vault stored
//      (VaultAsyncStorage in the real RN runtime — opt-in via
//      bootAgentBundle's asyncStorage path; tests cover the
//      default-vault path which uses the same AsyncStorage on
//      device).
//   2. Force-quit + relaunch.
//   3. The boot should be CLEAN (no onboarding flow, no
//      "Booting agents…" stuck state, just lands on the same
//      "Agents ready" screen).
//
// This is the canonical persistence smoke — if the vault adapter
// regresses or AsyncStorage's underlying RN bridge breaks, we'd
// see the second boot take noticeably longer OR show an error
// banner.  Both are testable here.

const { gotoChat } = require('./support/nav.js');

// SKIPPED (Detox survey 2026-10-09): this spec drives the classic CHAT SHELL through `gotoChat()` — the launcher's "← chat" affordance (`circle-to-chat`) was removed, so that surface is unreachable for a person (CircleLauncherScreen.js: "no chat shell to navigate to"). On development @ ed1a25ddc every test here timed out in `gotoChat` waiting for `chat-header-status`. Not an app bug. Port what is still worth pinning to the circle composer before un-skipping.
describe.skip('restart survival', () => {
  it('relaunching the app lands on the same "Agents ready" screen', async () => {
    // First boot.  M2 — the circle launcher is the default screen, so
    // reveal the chat shell to assert on its boot status.  Disable sync
    // first so gotoChat's tap doesn't hang on the never-idle bridge.
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await gotoChat();

    // Second boot — Detox terminates the app and starts fresh.
    // newInstance:false uses the existing process (faster); the
    // CLEAN re-boot scenario is newInstance:true with the same
    // app session, which is what device.reloadReactNative does.
    await device.terminateApp();
    await device.launchApp({ newInstance: false });
    await device.disableSynchronization();

    // Re-boot should reach "Agents ready" again — and FASTER than
    // the cold boot because the JS bundle is cached.  gotoChat waits
    // up to 60s; the re-boot is well under that.
    await gotoChat();

    // No error banner.  (We can't easily assert "no boot.boot_failed"
    // because that bound text is dynamic; instead we check that the
    // ready-state debug-toggle is interactable.)
    await expect(element(by.id('chat-debug-toggle'))).toBeVisible();
  });
});
