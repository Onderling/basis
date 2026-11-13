/* global device, by */
// HELP IS FOUND FROM SETTINGS, AND ME OPENS THE ASSISTANT, on the phone (walk row 78). Me → Assistant opens the person's
// ongoing conversation (the "+" sheet); Settings → Help opens the Help circle. Web twin:
// apps/basis/test-browser/help-and-assistant.spec.js. Release APK, emulator only.

const { launch, soon, tapSoon, firstBoot, backToLauncher, emulatorOnly } = require('./support/ui');

describe('Help from Settings, the assistant from Me, on the phone', () => {
  beforeAll(async () => {
    emulatorOnly('helpAndAssistant');
    await launch({ fresh: true });
    await firstBoot();
  });

  it('Me → Assistant opens the "+" conversation', async () => {
    await tapSoon(by.id('circle-tab-mij'));
    await tapSoon(by.id('profile-assistant'), 30_000);
    await soon(by.id('vandaag-plus-line'), 20_000);
    await device.takeScreenshot('help-01-assistant');
    await tapSoon(by.id('vandaag-plus-close'));
  });

  it('Settings → Help opens the Help circle', async () => {
    await backToLauncher();
    await tapSoon(by.id('circle-tab-mij'));
    await device.takeScreenshot('help-02-me-actions');
    await tapSoon(by.id('profile-settings'), 30_000);
    await tapSoon(by.id('settings-door-help'), 20_000);
    await soon(by.id('circle-detail-composer'), 30_000);
    await device.takeScreenshot('help-03-help-circle');
  });
});
