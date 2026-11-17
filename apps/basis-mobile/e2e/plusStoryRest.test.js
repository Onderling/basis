/* global device, element, by, waitFor, expect */
// THE "+" STORY ON THE PHONE, THE REST: the journeys of the assistant thread that plusStory.test.js does not walk, with
// the same stand-in model on this laptop (e2e/support/standInModel.js) set through the real settings screen. Web twin:
// apps/basis/test-browser/plus-story-rest.spec.js (the circle's act is plusStoryCircle.test.js, it needs a second person).
//
//   5.  a plain phrase: "zet melk op Vakantie" acts at once on the own list, and no model call is made;
//   11. another self: with only "Werk" ticked the thread is empty and nothing of the general self reaches the model;
//       ticked back, the conversation is there again;
//   10. it stays: the app closed and opened again keeps the thread; Forget empties it, and the model is no longer
//       handed what was said;
//   6.  the "/" list: typing "/" offers the door's own commands; picking one opens the same form as its button, and no
//       model call is made.
//
// Release APK, an emulator or an agreed test device (E2E_WIPE_OK): it deletes the app.

const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, emulatorOnly } = require('./support/ui');
const { pause, present, openPlus, putLine, say, textsOf, requestsReach, setOwnModel, makeSelf, onlySelf } = require('./support/plusWalk');
const { startStandInModel, reversePort } = require('./support/standInModel');

const SCRIPT = [
  { when: 'onthoud dat de sleutel', toolCall: { id: '__generic__:household:add:note', args: { body: 'de sleutel bij de buren ligt' } } },
  { when: 'waar ligt de sleutel', replyText: 'Weet ik niet.' },
  { when: 'wat kan je voor me doen', replyText: 'Je eigen notities, afspraken en lijsten.' },
];
const PHONE_PORT = 11434;
const LAPTOP_PORT = 8091;   // 8090 is Fable's real-model stand-in
const WERK = 'Werk';

let model;
let generalTurns = 0;
const turnCount = async () => (await textsOf(by.id('vandaag-plus-turn-you'))).length + (await textsOf(by.id('vandaag-plus-turn-assistant'))).length;
/** everything the model was handed BEFORE this turn's own line: the kept turns */
const historyOf = (req) => JSON.stringify((req?.messages ?? []).slice(0, -1));
const noThread = () => waitFor(element(by.id('vandaag-plus-thread'))).not.toExist().withTimeout(5000);

describe('the "+" story on the phone, the rest, with a stand-in model', () => {
  beforeAll(async () => {
    emulatorOnly('plusStoryRest');
    model = await startStandInModel(SCRIPT, { port: LAPTOP_PORT });
    reversePort(PHONE_PORT, LAPTOP_PORT);
    await launch({ fresh: true });
    await firstBoot();
    await setOwnModel(PHONE_PORT);
    await makeSelf(WERK);
    // with two selves ticked the "+" first asks which one it writes as: the walk starts as the general self alone
    await tapSoon(by.id('circle-tab-screens'));
    await onlySelf(null, WERK);
  });
  afterAll(async () => { await model?.close(); });

  it('the general self keeps a note through the conversation (journey 2\'s way)', async () => {
    await openPlus();
    await say('onthoud dat de sleutel bij de buren ligt');
    await soon(by.id('vandaag-plus-body'), 15_000);
    await tapSoon(by.id('vandaag-plus-save'));
    await soon(by.text('de sleutel bij de buren ligt'), 20_000);
  });

  it('5. a plain phrase acts at once on the own list, and no model call is made', async () => {
    await openPlus();
    const calls = model.requests.length;
    await say('nieuwe lijst Vakantie');
    await present(by.id('vandaag-plus-turn-assistant'));
    await say('zet melk op Vakantie');
    await pause(2500);
    const answers = await textsOf(by.id('vandaag-plus-turn-assistant'));
    await device.takeScreenshot('plus-rest-05-phrase');
    if (!/melk/.test(answers.at(-1) ?? '')) throw new Error(`the last answer does not name melk: ${JSON.stringify(answers.slice(-2))}`);
    if (model.requests.length !== calls) throw new Error(`a plain phrase asked the model ${model.requests.length - calls} time(s)`);
    generalTurns = await turnCount();
    await tapSoon(by.id('vandaag-plus-close'));
  });

  it('11. another self: an empty thread, nothing of the general self reaches the model; ticked back, it is there again', async () => {
    await onlySelf(WERK);
    await openPlus();
    await noThread();   // Werk has no conversation yet
    await device.takeScreenshot('plus-rest-11-werk-empty');
    const before = model.requests.length;
    await say('waar ligt de sleutel?');
    if ((await requestsReach(model, before + 1)) !== before + 1) throw new Error("Werk's line did not reach Werk's model once");
    const asWerk = JSON.stringify(model.requests.at(-1));
    if (asWerk.includes('de sleutel bij de buren ligt')) throw new Error("the general self's note was handed to Werk's model");
    if (asWerk.includes('Vakantie')) throw new Error("the general self's turns were handed to Werk's model");
    await present(by.text('Weet ik niet.').withAncestor(by.id('vandaag-plus-thread')));
    await device.takeScreenshot('plus-rest-11-werk-asked');
    await tapSoon(by.id('vandaag-plus-close'));
    await onlySelf(null, WERK);
    await openPlus();
    await present(by.text('zet melk op Vakantie').withAncestor(by.id('vandaag-plus-thread')), 15_000);
    const back = await turnCount();
    await device.takeScreenshot('plus-rest-11-general-back');
    if (back !== generalTurns) throw new Error(`the general self's conversation came back with ${back} turns, not ${generalTurns}`);
    await tapSoon(by.id('vandaag-plus-close'));
  });

  it('10. it stays: the app opened again keeps it; Forget empties it, and the model is no longer handed what was said', async () => {
    await pause(1500);   // the device log saves on a short debounce
    await launch();
    await soon(by.id('circle-tab-screens'), 120_000);
    await openPlus();
    await present(by.text('zet melk op Vakantie').withAncestor(by.id('vandaag-plus-thread')), 20_000);
    const kept = await turnCount();
    await device.takeScreenshot('plus-rest-10-kept');
    if (kept !== generalTurns) throw new Error(`after a restart the thread has ${kept} turns, not ${generalTurns}`);
    await tapSoon(by.id('vandaag-plus-forget'));
    await noThread();
    const before = model.requests.length;
    await say('wat kan je voor me doen?');
    if ((await requestsReach(model, before + 1)) !== before + 1) throw new Error('the question did not reach the model once');
    if (/onthoud dat de sleutel|Vakantie/.test(historyOf(model.requests.at(-1)))) throw new Error('the forgotten turns were handed to the model');
    await present(by.text('Je eigen notities, afspraken en lijsten.').withAncestor(by.id('vandaag-plus-thread')));
    await device.takeScreenshot('plus-rest-10-forgotten');
  });

  it('a long conversation: the sheet opens with the line in view, and keeps it there after each turn', async () => {
    for (let i = 1; i <= 6; i += 1) {
      await say(`blauwe olifant nummer ${i}`);
      await pause(1500);
      await expect(element(by.id('vandaag-plus-line'))).toBeVisible();
    }
    await tapSoon(by.id('vandaag-plus-close'));
    await openPlus();
    await pause(1000);
    await device.takeScreenshot('plus-rest-long-thread-open');
    await expect(element(by.id('vandaag-plus-line'))).toBeVisible();
  });

  it('6. the "/" list: the same acts as the buttons, and picking one opens the same form, with no model call', async () => {
    const calls = model.requests.length;
    await putLine('/');
    await present(by.id('vandaag-plus-suggestion'), 10_000);
    const offered = await textsOf(by.id('vandaag-plus-suggestion'));
    await device.takeScreenshot('plus-rest-06-slash');
    const appt = offered.find((s) => s.startsWith('/addappt'));
    if (!appt) throw new Error(`the appointment act is not offered: ${JSON.stringify(offered)}`);
    if (!offered.some((s) => s.startsWith('/add-note'))) throw new Error(`the note act is not offered: ${JSON.stringify(offered)}`);
    if (offered.some((s) => s.startsWith('/whoami'))) throw new Error('a device command is offered in the own "+"');
    // the list is long: the sheet scrolls, and the line and the first acts stay reachable (they once fell off the top)
    await waitFor(element(by.text(appt).withAncestor(by.id('vandaag-plus')))).toBeVisible()
      .whileElement(by.id('vandaag-plus-scroll')).scroll(300, 'up');
    await device.takeScreenshot('plus-rest-06-slash-top');
    await pause(800);
    await element(by.text(appt).withAncestor(by.id('vandaag-plus'))).tap();
    await pause(1000);
    await tapSoon(by.id('vandaag-plus-read'));
    await soon(by.id('vandaag-plus-title'), 10_000);
    const when = await firstOf([by.id('vandaag-plus-when'), by.id('vandaag-plus-ask-time')], 5000);
    await device.takeScreenshot('plus-rest-06-form');
    if (when < 0) throw new Error('the appointment form has no time field, as its button opens it');
    if (model.requests.length !== calls) throw new Error('a "/" line asked the model');
    if (!(await isVisible(by.id('vandaag-plus-save')))) throw new Error('the form has no Save');
  });
});
