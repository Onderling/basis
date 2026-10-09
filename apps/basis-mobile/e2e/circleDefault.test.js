// Circle launcher as the default screen (v2 M2, 2026-05-29).
//
// Verifies the mobile landing-surface flip:
//   1. On cold launch the circle launcher (testID circle-launcher) is
//      the visible screen.
//   2. Tapping "← chat" reveals the always-mounted classic chat shell
//      (proving it boots even when the launcher is the visible screen).
//   3. Tapping the "Circles" pill returns to the launcher.
//
// Runs against the RELEASE APK (embedded JS bundle).

const { gotoChat } = require('./support/nav.js');

describe('circle launcher is the default screen (M2)', () => {
  beforeAll(async () => {
    // The app's NKN timers never let RN idle, so launchApp would otherwise
    // hang on Detox's TimersIdlingResource. Launch with synchronization
    // disabled natively (detoxEnableSynchronization: 0).
    await device.launchApp({ newInstance: true, launchArgs: { detoxEnableSynchronization: 0 } });
    await device.disableSynchronization();
  });

  it('cold launch lands on the circle launcher', async () => {
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(60_000);
  });

  // SKIPPED (Detox survey 2026-10-09): the "← chat" affordance (`circle-to-chat`) was removed — no chat shell to reveal.
  it.skip('"← chat" reveals the chat shell; "Circles" returns to the launcher', async () => {
    // gotoChat taps "← chat" then waits for the chat boot status — which
    // only appears if the always-mounted chat shell actually booted.
    await gotoChat();
    await expect(element(by.id('chat-header-status'))).toBeVisible();

    // Back to the launcher via the Circles pill.
    await element(by.id('open-circles')).tap();
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(10_000);
  });
});
