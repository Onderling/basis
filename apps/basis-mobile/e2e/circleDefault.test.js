// Circle launcher as the default screen (v2 M2, 2026-05-29).
//
// Verifies the mobile landing surface: on cold launch the circle launcher (testID circle-launcher) is the visible screen.
//
// Runs against the RELEASE APK (embedded JS bundle).

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
});
