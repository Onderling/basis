/* global device, element, by */
// HELP READS A QUESTION IN EITHER LANGUAGE, on the phone (walk row 81: "hoe maak ik een kring?" in an app set to English
// got ~30 English topic buttons). The help conversation answers the Dutch question with the make-a-circle card; a
// question it cannot answer offers its likeliest topics and "All topics". Web twin:
// apps/basis/test-browser/help-any-language.spec.js. Release APK, emulator only (the emulator runs in English).

const { launch, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');

const HELP_BOT = 'urn:onderling:bot';   // the help row's contact (apps/basis/src/v2/helpCircle.js)

async function say(text) {
  await element(by.id('circle-detail-composer-input')).replaceText(text);
  await tapSoon(by.id('circle-detail-composer-send'));
}

describe('Help reads Dutch and English, on the phone', () => {
  beforeAll(async () => {
    emulatorOnly('helpAnyLanguage');
    await launch({ fresh: true });
    await firstBoot();
    await tapSoon(by.id('circle-tab-contacten'), 60_000);
    await tapSoon(by.id(`contact-row-${HELP_BOT}`), 60_000);
    await soon(by.id('circle-detail-composer'), 30_000);
  });

  it('"hoe maak ik een kring?" gets the make-a-circle card, not the topic list', async () => {
    await say('hoe maak ik een kring?');
    // a card answered it (its provenance line says so, in the app's language: English on the emulator), not the topic
    // list; the screenshot shows which card (Detox's by.text takes no pattern, and the bubble text is long)
    await soon(by.text('· answered directly — no language model used'), 20_000);
    await device.takeScreenshot('help-lang-01-card');
  });

  it('a question it cannot answer offers its likeliest topics and "All topics"; that chip posts the rest', async () => {
    await say('telefoontjes plegen');   // no card answers it; one topic shares a word with it
    await soon(by.text('All topics'), 20_000);
    await device.takeScreenshot('help-lang-02-likely');
    await tapSoon(by.text('All topics'));
    await device.takeScreenshot('help-lang-03-all');
  });
});
