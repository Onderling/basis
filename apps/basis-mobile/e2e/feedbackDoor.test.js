/* global device, element, by */
// FEEDBACK FROM THE PHONE, end to end (the function matrix's feedback × mobile cell; the mobile half of the alpha's
// two-phone walk + feedback condition). A fresh install adds a connection point from Today, opens the feedback door
// (`/feedback` in a composer: the same act the "+" sheet and the foot of Settings run), says yes to adding the feedback
// contact, and writes. The maker (e2e/support/relayPeer.mjs --maker: the fixed test person this e2e build carries as
// its feedback contact) receives it and answers; the answer shows in the phone's thread.
// Runs against an E2E release APK (`npm run detox:build:e2e`: the build carries the maker's card); deletes the app, so
// emulator only.

const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer } = require('./support/peer');
const MAKER = require('./support/makerCard.fixture.json');

const HELP_BOT = 'urn:onderling:bot';   // the help row's contact (ONDERLING_BOT_WEBID): a composer to type /feedback in
const stamp = Date.now().toString(36);
const NOTE = `de knop doet niets ${stamp}`;
const ANSWER = `dank je, ik kijk ernaar ${stamp}`;
let maker = null;

describe('feedback from the phone: the door, the maker receives it, the answer comes back', () => {
  beforeAll(async () => {
    emulatorOnly('feedbackDoor');
    maker = await startPeer(['--maker']);
    // the build must carry THIS person's card, or the door writes to someone the walk cannot hear (the identity is
    // compared: the live card also names this run's relay)
    if (maker.ready.webid !== MAKER.webid) {
      throw new Error(`the maker's card is not the fixture's: rebuild the fixture (node e2e/support/makerCard.mjs) and the e2e APK`);
    }
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    maker?.stop();
  });

  it("Today's card adds a connection point: the maker's relay", async () => {
    await tapSoon(by.id('circle-tab-screens'), 30_000);
    // a tap while the app is still starting is lost (the sheet never opens): tap until the field shows
    let open = false;
    for (let i = 0; i < 5 && !open; i += 1) {
      await tapSoon(by.id('onb-reach-add'), 30_000);
      open = (await firstOf([by.id('point-add-input')], 8_000)) === 0;
    }
    if (!open) { await device.takeScreenshot('fb-01a-no-point-sheet'); throw new Error('the connection point sheet never opened'); }
    await element(by.id('point-add-input')).replaceText(maker.ready.relayUrl);
    await tapSoon(by.id('point-add-submit'));
    await new Promise((r) => setTimeout(r, 3000));
    await device.takeScreenshot('fb-01-point-added');
    await device.pressBack();
  });

  it('the feedback door opens the thread to the maker, after the person says yes', async () => {
    await tapSoon(by.id('circle-tab-contacten'), 30_000);
    await tapSoon(by.id(`contact-row-${HELP_BOT}`), 60_000);
    await soon(by.id('circle-detail-composer-input'), 30_000);
    await element(by.id('circle-detail-composer-input')).replaceText('/feedback');
    await new Promise((r) => setTimeout(r, 800));
    await tapSoon(by.id('circle-detail-composer-send'));
    // adding the feedback contact is the person's own tap (the platform's confirm)
    // (its button reads circle.confirm.accept: "Confirm")
    const which = await firstOf([by.text('Confirm'), by.text('CONFIRM')], 20_000);
    if (which < 0) { await device.takeScreenshot('fb-02a-no-offer'); throw new Error('the feedback door asked nothing'); }
    await element([by.text('Confirm'), by.text('CONFIRM')][which]).tap();
    await soon(by.id('contact-thread-input'), 30_000);
    await device.takeScreenshot('fb-02-thread');
  });

  it('a note written there reaches the maker, and the answer shows in the thread', async () => {
    await element(by.id('contact-thread-input')).replaceText(NOTE);
    await tapSoon(by.id('contact-thread-send'));
    const heard = await maker.next('contact-heard', (m) => String(m.text ?? '').toLowerCase().includes(NOTE.toLowerCase()), 90_000)
      .catch(async (err) => {
        // say WHICH branch: nothing arrived, it fell to no lane (unrouted), or the maker refused the turn
        await device.takeScreenshot('fb-03a-not-heard');
        maker.send({ do: 'dump' });
        const dump = await maker.next('dump', () => true, 20_000).catch(() => null);
        throw new Error(`${err.message}\nthe maker holds: ${JSON.stringify(dump)}`);
      });
    maker.send({ do: 'contact-say', text: ANSWER });
    const said = await maker.next('contact-said', () => true, 60_000);
    if (!said.ok) throw new Error(`the maker's answer did not go out: ${JSON.stringify(said)} (heard from ${heard.from})`);
    await soon(by.text(ANSWER), 90_000);
    await device.takeScreenshot('fb-03-answer');
  });
});
