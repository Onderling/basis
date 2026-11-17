/* global device, element, by, waitFor */
// THE FIRST OPEN ON THE PHONE: a fresh install's welcome offers three doors (scan, introduction, just continue). The
// "introduction" door boots the app and opens the seven cards over Today; Today has no "New to Basis?" card after them.
// ("Just continue" is every other walk's first boot: it keeps the old Start's testID.) Web twin:
// apps/basis/test-browser/first-open.spec.js. Release APK, an emulator or an agreed test device (E2E_WIPE_OK).

const { launch, isVisible, soon, tapSoon, emulatorOnly } = require('./support/ui');

describe('the first open on the phone', () => {
  beforeAll(async () => {
    emulatorOnly('firstOpen');
    await launch({ fresh: true });
  });

  it('the welcome shows the three doors', async () => {
    await soon(by.id('first-run-welcome'), 90_000);
    for (const id of ['first-run-scan', 'first-run-intro', 'first-run-start']) await soon(by.id(id), 10_000);
    await device.takeScreenshot('first-open-doors');
  });

  it('"introduction" boots the app and opens the seven cards over Today; afterwards no intro card on Today', async () => {
    await tapSoon(by.id('first-run-intro'));
    // the first boot: the recovery words may come first (a throwaway identity), confirmed whenever they show
    const until = Date.now() + 180_000;
    let open = false;
    while (Date.now() < until && !open) {
      if (await isVisible(by.id('mnemonic-create'))) await element(by.id('mnemonic-create-written')).tap();
      open = await isVisible(by.id('intro-deck-card-welcome'));
      if (!open) await new Promise((r) => setTimeout(r, 500));
    }
    if (!open) throw new Error('the introduction never opened after the "introduction" door');
    await device.takeScreenshot('first-open-intro');
    await tapSoon(by.id('intro-deck-skip'));
    await waitFor(element(by.id('intro-deck'))).not.toExist().withTimeout(10_000);
    await soon(by.id('vandaag-day'), 30_000);
    await waitFor(element(by.id('onb-card-intro'))).not.toExist().withTimeout(15_000);
    await device.takeScreenshot('first-open-today');
  });
});
