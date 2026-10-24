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

  // Availability is a door under the gear (Instellingen → Verbinding, 2026-10-24): Mij → the gear → Verbinding →
  // "Availability"; its Save and its back return to Verbinding.
  async function openAvailability() {
    await element(by.id('circle-tab-mij')).tap();
    await waitFor(element(by.id('profile-settings'))).toBeVisible().withTimeout(10_000);
    await element(by.id('profile-settings')).tap();
    await waitFor(element(by.id('settings-group-connection'))).toBeVisible().withTimeout(10_000);
    await element(by.id('settings-group-connection')).tap();
    await waitFor(element(by.id('settings-door-availability'))).toBeVisible()
      .whileElement(by.id('circle-settings-group')).scroll(400, 'down');
    await element(by.id('settings-door-availability')).tap();
    // The loading state carries the same `circle-availability` id — wait for the loaded form (its holiday switch).
    await waitFor(element(by.id('holiday-active'))).toBeVisible().withTimeout(15_000);
  }

  it('opens Availability from Verbinding, toggles holiday, Saves back to Verbinding', async () => {
    await openAvailability();
    await element(by.id('holiday-active')).tap();
    await element(by.id('circle-availability-save')).tap();
    await waitFor(element(by.id('circle-settings-group'))).toBeVisible().withTimeout(10_000);
  });

  it('the Circles tab returns from Availability to the launcher', async () => {
    await openAvailability();
    await element(by.id('circle-tab-circles')).tap();
    await waitFor(element(by.id('circle-launcher')))
      .toBeVisible()
      .withTimeout(10_000);
  });
});
