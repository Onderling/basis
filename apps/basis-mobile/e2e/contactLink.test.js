/* global device, element, by */
// A CONTACT CARD OPENED AS A LINK, on the phone: the add sheet comes up where the person is, and once confirmed the
// person is in Contacts. (It did nothing at all: the link was handled by the hidden classic shell, whose sheet and
// "added" line nobody could see.) The card is the app's own encoder's (support/contactCard.fixture.json, pinned by
// test/e2eContactCardFixture.test.js). Release APK, emulator only.

const { launch, isVisible, firstOf, firstBoot, tapSoon, soon, emulatorOnly } = require('./support/ui');
const PERSON = require('./support/contactCard.fixture.json');

describe('a contact card opened as a link on the phone', () => {
  beforeAll(async () => {
    emulatorOnly('contactLink');
    await launch({ fresh: true });
    await firstBoot();
  });

  it('opens the add sheet where the person is; confirmed, the person is in Contacts', async () => {
    await tapSoon(by.id('circle-tab-contacten'), 30_000);
    await soon(by.id('contacts-screen'), 30_000);
    await device.openURL({ url: PERSON.uri });
    // the sheet SLIDES in: settle, press its own button, and press again only while it is still up
    if ((await firstOf([by.id('contact-add-sheet')], 20_000)) !== 0) throw new Error('the card link opened no add sheet');
    await device.takeScreenshot('contact-link-01-sheet');
    for (let i = 0; i < 3 && (await isVisible(by.id('contact-add-sheet'))); i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      try { await element(by.id('contact-sheet-submit')).tap(); } catch { /* mid-slide: the next round retries */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    let found = false;
    for (let i = 0; i < 8 && !found; i += 1) {
      await tapSoon(by.id('circle-tab-circles'));
      await tapSoon(by.id('circle-tab-contacten'));
      await new Promise((r) => setTimeout(r, 2000));
      found = await isVisible(by.text(PERSON.name));
    }
    await device.takeScreenshot('contact-link-02-contacts');
    if (!found) throw new Error(`${PERSON.name} is not in Contacts after the sheet was confirmed`);
  });
});
