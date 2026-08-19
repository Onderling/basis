// Circle settings-family screens reachable from the launcher (v2 M3,
// 2026-05-29).
//
// The launcher is the default screen (M2).  This verifies the M3 RN
// port of the availability screen end-to-end on device: it opens from
// the launcher, a Switch toggles, and Save returns to the launcher
// (persisting through the AsyncStorage-backed store).
//
// The per-circle Settings / My-settings screens carry testIDs
// (circle-settings / circle-override, reached via circle-detail-settings
// / circle-detail-mine) but need a created circle to navigate into, so
// they're left to the real-device pass + the vitest-covered shared model.
//
// Runs against the RELEASE APK (embedded JS bundle).

describe('circle availability screen (M3)', () => {
  beforeAll(async () => {
    // The app's NKN timers never let RN idle, so launchApp would otherwise
    // hang on Detox's TimersIdlingResource. Launch with synchronization
    // disabled natively (detoxEnableSynchronization: 0).
    await device.launchApp({ newInstance: true, launchArgs: { detoxEnableSynchronization: 0 } });
    await device.disableSynchronization();
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(60_000);
  });

  it('opens Availability from the launcher, toggles holiday, Saves back to the launcher', async () => {
    await element(by.id('circle-tab-mij')).tap();
    await waitFor(element(by.id('circle-availability')))
      .toBeVisible()
      .withTimeout(10_000);

    // Toggle holiday mode (RN Switch) + save.
    await element(by.id('holiday-active')).tap();
    await element(by.id('circle-availability-save')).tap();

    // Save returns to the launcher.
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(10_000);
  });

  it('the Circles tab returns from Availability to the launcher', async () => {
    await element(by.id('circle-tab-mij')).tap();
    await waitFor(element(by.id('circle-availability')))
      .toBeVisible()
      .withTimeout(10_000);
    // No back arrow on a tab screen — the Circles tab is the way back.
    await element(by.id('circle-tab-circles')).tap();
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(10_000);
  });

  // (Batch 5) the cross-circle Stream spec is GONE with the view it tapped: `circle-tab-stroom` left
  // the tab bar long ago, so this spec could only fail — a must-fail spec in the suite teaches people
  // to ignore red. The LOG the Stream projected is untouched; its surfaces are the circle tabs above.
});
