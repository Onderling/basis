/* global device, element, by, waitFor */
// THE INTRODUCTION ON THE PHONE: Today's "New to Basis?" card → "Read more" opens the seven cards, one per screen;
// "Next" turns the page, the last card's button leaves for Today, and the card has gone from Today. Web twin:
// apps/basis/test-browser/intro-deck.spec.js. Release APK, an emulator or an agreed test device (E2E_WIPE_OK).

const { launch, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');

const CARDS = ['welcome', 'circles', 'contacts', 'plus', 'selves', 'nearby', 'keys'];

describe('the introduction on the phone', () => {
  beforeAll(async () => {
    emulatorOnly('introDeck');
    await launch({ fresh: true });
    await firstBoot();
  });

  it('"Read more" opens the seven cards in order; the last button leaves for Today and the card is gone', async () => {
    await tapSoon(by.id('circle-tab-screens'));
    await soon(by.id('onb-intro-more'), 30_000);   // the onboarding strip is the top of Today
    await tapSoon(by.id('onb-intro-more'));
    for (const [i, id] of CARDS.entries()) {
      await soon(by.id(`intro-deck-card-${id}`), 10_000);
      await device.takeScreenshot(`intro-${i + 1}-${id}`);
      await tapSoon(by.id('intro-deck-next'));
    }
    await waitFor(element(by.id('intro-deck'))).not.toExist().withTimeout(10_000);
    await waitFor(element(by.id('onb-card-intro'))).not.toExist().withTimeout(15_000);
    await device.takeScreenshot('intro-done-today');
  });
});
