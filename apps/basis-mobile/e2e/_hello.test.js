// Detox sanity check (D-0 sanity). Minimal — just proves
// that the build-test-launch loop works.  If this fails, the
// problem isn't in our test logic.
//
// Runs against the RELEASE APK (embedded JS bundle, no
// expo-dev-launcher).  Metro doesn't need to be running.

describe('Detox sanity', () => {
  beforeAll(async () => {
    // Synchronization off at LAUNCH too, like every other spec: the app's network timers never let RN idle, so a
    // synchronized launch hung the hook for its full 180 s (Detox survey 2026-10-09).
    await device.launchApp({ newInstance: true, launchArgs: { detoxEnableSynchronization: 0 } });
    // Disable synchronization AFTER launch (the bridge has to exist
    // before this call can route through).  Our app has perpetual
    // background work (NknTransport reconnect loop, periodic
    // catch-up timers, …) that never goes idle, so the default
    // sync-on-idle would time out.
    await device.disableSynchronization();
  });

  it('app launches and the circle launcher (default screen) is visible', async () => {
    // M2 — the circle launcher is the default landing screen.
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(60_000);
  });
});
