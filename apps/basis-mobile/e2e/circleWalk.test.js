/* global device, element, by, waitFor, expect */
// A circle made on the phone, and the screens that need one — walked on an emulator (2026-10-22).
//
//   1. Today's "Make a circle" opens the create wizard where the person is (it used to do nothing on Today: the
//      wizard was mounted in the circles list only), and the wizard makes the circle.
//   2. The wizard's last step opens the new circle's invite card; "Invite a bot" turns it into a bot invite.
//   3. The circle's ⋯ menu reaches its settings and its admin panel.
//
// Each step leaves a screenshot (Detox's artifacts), so a walk in light or dark can be read afterwards:
// `adb shell cmd uimode night yes` before the run for the dark one. Runs against the RELEASE APK, like the rest.

const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, emulatorOnly } = require('./support/ui');

describe('a circle made on the phone, and its invite, settings and admin', () => {
  beforeAll(async () => {
    // A fresh install (it deletes the app): emulator only, refused before the device is touched.
    emulatorOnly('circleWalk');
    await launch({ fresh: true });
    await firstBoot();
  });

  it("Today's Make a circle opens the wizard there, and the wizard makes the circle", async () => {
    await waitFor(element(by.id('onb-create'))).toBeVisible().withTimeout(30_000);
    await element(by.id('onb-create')).tap();
    await waitFor(element(by.id('create-group-wizard'))).toBeVisible().withTimeout(15_000);
    await device.takeScreenshot('walk-01-wizard');
    await element(by.id('wizard-radio-household')).tap();
    await element(by.id('create-group-name')).typeText('Huis');
    await device.pressBack();   // the keyboard — it covers the handle field below
    // the founder's handle is asked only when their profile has none (a fresh install has none)
    let hasHandle = true;
    try { await expect(element(by.id('wizard-handle'))).toExist(); } catch { hasHandle = false; }
    if (hasHandle) {
      await element(by.id('wizard-handle')).replaceText('frits');   // no keyboard opens, so no Back (it would close the wizard)
    }
    // steps 2–5, then Review → Create
    for (let i = 0; i < 6; i += 1) {
      if (await isVisible(by.id('create-group-create'))) break;
      await element(by.id('create-group-next')).tap();
      await new Promise((r) => setTimeout(r, 600));
    }
    await device.takeScreenshot('walk-02-review');
    await element(by.id('create-group-create')).tap();
  });

  it('the new circle opens its invite card; Invite a bot makes it a bot invite', async () => {
    // a device without a relay is asked for one first (the invite carries it); Later goes on without
    const first = await firstOf([by.id('relay-question'), by.id('invite-for-bot')], 60_000);
    if (first === 0) {
      await device.takeScreenshot('walk-03-relay-question');
      await tapSoon(by.id('relay-question-later'));
      // one modal closes as the next opens: give the window focus a moment to settle (Detox reads the focused root)
      await new Promise((r) => setTimeout(r, 2000));
    }
    await soon(by.id('invite-for-bot'));
    await device.takeScreenshot('walk-04-invite');
    await tapSoon(by.id('invite-for-bot'));
    // the bot invite card has no "Invite a bot" of its own: it IS one
    const bot = await firstOf([by.id('relay-question')], 4_000);
    if (bot === 0) await tapSoon(by.id('relay-question-later'));
    await soon(by.id('invite-bot-hint'));   // the bot card itself, not just the old button gone
    await device.takeScreenshot('walk-05-bot-invite');
    await device.pressBack();   // closes the card (the modal's request-close)
    await waitFor(element(by.id('invite-bot-hint'))).not.toExist().withTimeout(10_000);
  });

  it("the circle's ⋯ menu reaches its settings and its admin panel", async () => {
    await element(by.id('circle-tab-circles')).tap();
    await waitFor(element(by.text('Huis')).atIndex(0)).toBeVisible().withTimeout(20_000);
    await element(by.text('Huis')).atIndex(0).tap();
    await waitFor(element(by.id('circle-detail-more'))).toBeVisible().withTimeout(20_000);
    await device.takeScreenshot('walk-06-circle');
    await element(by.id('circle-detail-more')).tap();
    await waitFor(element(by.id('circle-detail-more-menu'))).toBeVisible().withTimeout(10_000);
    await device.takeScreenshot('walk-07-menu');
    await element(by.id('circle-detail-settings')).tap();
    await waitFor(element(by.id('circle-settings'))).toBeVisible().withTimeout(20_000);
    await device.takeScreenshot('walk-08-settings');
    await device.pressBack();
    await waitFor(element(by.id('circle-detail-more'))).toBeVisible().withTimeout(20_000);
    await element(by.id('circle-detail-more')).tap();
    await waitFor(element(by.id('circle-detail-more-menu'))).toBeVisible().withTimeout(10_000);
    await waitFor(element(by.id('circle-detail-admin'))).toBeVisible().withTimeout(10_000);
    await element(by.id('circle-detail-admin')).tap();
    await waitFor(element(by.id('circle-admin'))).toBeVisible().withTimeout(20_000);
    // the panel says it is loading until the roster is read — then the founder is on it (never "no members" first)
    await waitFor(element(by.id('admin-loading'))).not.toExist().withTimeout(20_000);
    await expect(element(by.text('No members yet.'))).not.toExist();
    await device.takeScreenshot('walk-09-admin');
  });
});
