/* global device, element, by */
// THE "+" IS ONE KEPT CONVERSATION, on the phone. What the person typed in the "+" and what it answered are still there
// when the sheet opens again, and after the app restarts (the bot's own turn entries on the device's log); Forget
// empties it. Web twin: apps/basis/test-browser/plus-kept-thread.spec.js. Release APK, emulator only.

const { launch, isVisible, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');

const LINE = 'blauwe olifanten dansen';

async function openPlus() {
  await tapSoon(by.id('vandaag-plus-open'), 30_000);
  await soon(by.id('vandaag-plus'), 20_000);
}

describe('the "+" on the phone is one kept conversation', () => {
  beforeAll(async () => {
    emulatorOnly('plusKeptThread');
    await launch({ fresh: true });
    await firstBoot();
  });

  it('a line and its answer are in the thread, and still there when the sheet opens again', async () => {
    await tapSoon(by.id('circle-tab-screens'));
    await openPlus();
    if (await isVisible(by.id('vandaag-plus-thread'))) throw new Error('a fresh install already has a conversation');
    await element(by.id('vandaag-plus-line')).replaceText(LINE);
    await tapSoon(by.id('vandaag-plus-read'));
    await soon(by.text(LINE).withAncestor(by.id('vandaag-plus-thread')), 15_000);
    await soon(by.id('vandaag-plus-turn-assistant'), 10_000);
    await device.takeScreenshot('plus-thread-01-read');
    await tapSoon(by.id('vandaag-plus-close'));
    await openPlus();
    await soon(by.text(LINE).withAncestor(by.id('vandaag-plus-thread')), 10_000);
    await tapSoon(by.id('vandaag-plus-close'));
  });

  it('kept across a restart of the app', async () => {
    await new Promise((r) => setTimeout(r, 2000));   // the device log saves on a short debounce
    await launch();
    await soon(by.id('circle-tab-screens'), 90_000);
    await tapSoon(by.id('circle-tab-screens'));
    await openPlus();
    await soon(by.text(LINE).withAncestor(by.id('vandaag-plus-thread')), 30_000);
    await device.takeScreenshot('plus-thread-02-after-restart');
  });

  it('Forget empties it', async () => {
    await tapSoon(by.id('vandaag-plus-forget'));
    await new Promise((r) => setTimeout(r, 1000));
    if (await isVisible(by.id('vandaag-plus-thread'))) throw new Error('the thread is still there after Forget');
    await device.takeScreenshot('plus-thread-03-forgotten');
  });
});
