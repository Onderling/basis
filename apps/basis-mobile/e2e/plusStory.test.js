/* global device, element, by, waitFor */
// THE "+" STORY ON THE PHONE: the journeys of the assistant thread (plans: the "+" as a conversation with your own
// assistant), walked on a real device with a stand-in model on this laptop (e2e/support/standInModel.js), reached as
// the person's own LOCAL model through `adb reverse` and set through the real settings screen. Everything but the
// model is the shipped app. Web twin: apps/basis/test-browser/plus-story.spec.js.
//
//   8. no model: the question says no model is set, what works, and where to set one;
//   9. whose model: once set, the top of the thread names the own route by its host;
//   1. a question: an answer in words, from a model told it is the person's OWN place (no household background);
//   2. remember this: a filled note form; nothing stored until Save;
//   3. ask it back: the note's words reach the model; the answer is said;
//   4. a follow-up: the previous turn reaches the model; the proposal names the key; closing it stores nothing, said.
//
// Release APK, an emulator or an agreed test device (E2E_WIPE_OK): it deletes the app.

const { launch, soon, tapSoon, firstOf, firstBoot, emulatorOnly } = require('./support/ui');
const { startStandInModel, reversePort } = require('./support/standInModel');

const SCRIPT = [
  { when: 'wat kan je voor me doen', replyText: 'Ik houd je eigen notities, afspraken en lijsten bij.' },
  { when: 'onthoud dat de sleutel', toolCall: { id: '__generic__:household:add:note', args: { body: 'de sleutel ligt bij de buren' } } },
  { when: 'waar ligt de sleutel', replyText: 'Bij de buren.' },
  { when: 'zet dat morgen om 10', toolCall: { id: 'addEvent', args: { title: 'sleutel ophalen bij de buren' } } },
];
const PHONE_PORT = 11434;
const LAPTOP_PORT = 8091;   // 8090 is Fable's real-model stand-in

let model;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPlus() {
  await tapSoon(by.id('circle-tab-screens'));
  await tapSoon(by.id('vandaag-plus-open'), 30_000);
  await soon(by.id('vandaag-plus'), 20_000);
}

/** Type a line and read it; resolves when the thread holds the line (its answer follows). */
async function say(line) {
  await element(by.id('vandaag-plus-line')).replaceText(line);
  // the sheet must have TAKEN the line before Read (a tap that comes first goes nowhere: measured 2026-11-16)
  await expect(element(by.id('vandaag-plus-line'))).toHaveText(line);
  await pause(1500);
  await tapSoon(by.id('vandaag-plus-read'));
  await soon(by.text(line).withAncestor(by.id('vandaag-plus-thread')), 20_000);
}

/** The own model, set as a person sets it: Mij → the gear → Weergave → the assistant section, preset Local. */
async function setOwnModel() {
  await tapSoon(by.id('circle-tab-mij'));
  await tapSoon(by.id('profile-settings'), 15_000);
  await tapSoon(by.id('settings-group-appearance'), 15_000);
  await waitFor(element(by.id('user-llm-preset-local-ollama'))).toBeVisible()
    .whileElement(by.id('circle-settings-group')).scroll(400, 'down');
  await element(by.id('user-llm-preset-local-ollama')).tap();
  await waitFor(element(by.id('user-llm-llmBaseUrl'))).toBeVisible()
    .whileElement(by.id('circle-settings-group')).scroll(200, 'down');
  await element(by.id('user-llm-llmBaseUrl')).replaceText(`http://127.0.0.1:${PHONE_PORT}`);
  await element(by.id('user-llm-llmModel')).replaceText('stand-in');
  await waitFor(element(by.id('user-llm-save'))).toBeVisible()
    .whileElement(by.id('circle-settings-group')).scroll(200, 'down');
  await element(by.id('user-llm-save')).tap();
  await pause(1500);
  await device.takeScreenshot('plus-story-00-model-set');
}

describe('the "+" story on the phone, with a stand-in model', () => {
  beforeAll(async () => {
    emulatorOnly('plusStory');
    model = await startStandInModel(SCRIPT, { port: LAPTOP_PORT });
    reversePort(PHONE_PORT, LAPTOP_PORT);
    await launch({ fresh: true });
    await firstBoot();
  });
  afterAll(async () => { await model?.close(); });

  it('8. no model: the question says no model is set, and nothing reaches a model', async () => {
    await openPlus();
    await soon(by.id('vandaag-plus-route'), 10_000);
    await say('wat kan je voor me doen?');
    await soon(by.id('vandaag-plus-turn-assistant'), 15_000);
    await device.takeScreenshot('plus-story-08-no-model');
    if (model.requests.length !== 0) throw new Error(`a model was asked without one being set: ${model.requests.length}`);
    await tapSoon(by.id('vandaag-plus-close'));
  });

  it('9 and 1. with the own model set: the route names its host; a question is answered, told it is the own place', async () => {
    await setOwnModel();
    await openPlus();
    // the route line is one sentence (Detox matches whole texts): either language
    const host = `127.0.0.1:${PHONE_PORT}`;
    const route = await firstOf([
      by.text(`Je eigen model antwoordt, op ${host}: een model dat je zelf draait.`),
      by.text(`Your own model answers, on ${host}: a model you run yourself.`),
    ], 15_000);
    if (route < 0) throw new Error('the route line does not name the own model by its host');
    await device.takeScreenshot('plus-story-09-route');
    const before = model.requests.length;
    await say('wat kan je voor me doen?');
    await soon(by.text('Ik houd je eigen notities, afspraken en lijsten bij.'), 20_000);
    if (model.requests.length !== before + 1) throw new Error(`expected one model call, got ${model.requests.length - before}`);
    const sys = String(model.requests.at(-1).system ?? '');
    if (!/OWN place/.test(sys)) throw new Error('the model was not told it is the own place');
    if (/Household background|share a household/.test(sys)) throw new Error('the household bot background reached the own model');
    await device.takeScreenshot('plus-story-01-question');
  });

  it('2 and 3. remember this, then ask it back: the note reaches the model', async () => {
    await say('onthoud dat de sleutel bij de buren ligt');
    await soon(by.id('vandaag-plus-body'), 15_000);
    await expect(element(by.id('vandaag-plus-body'))).toHaveText('de sleutel ligt bij de buren');
    await device.takeScreenshot('plus-story-02-note-form');
    await tapSoon(by.id('vandaag-plus-save'));
    await soon(by.text('de sleutel ligt bij de buren'), 20_000);
    await openPlus();
    await say('waar ligt de sleutel?');
    await soon(by.text('Bij de buren.'), 20_000);
    if (!JSON.stringify(model.requests.at(-1).messages).includes('de sleutel ligt bij de buren')) throw new Error('the note did not reach the model');
    await device.takeScreenshot('plus-story-03-ask-back');
  });

  it('4. a follow-up: the previous turn reaches the model; the proposal names the key; closed, nothing is stored and it is said', async () => {
    await say('zet dat morgen om 10 in mijn agenda');
    await soon(by.id('vandaag-plus-title'), 20_000);
    if (!JSON.stringify(model.requests.at(-1).messages).includes('waar ligt de sleutel')) throw new Error('the previous turn did not reach the model');
    await expect(element(by.id('vandaag-plus-title'))).toHaveText('sleutel ophalen bij de buren');
    await device.takeScreenshot('plus-story-04-proposal');
    await tapSoon(by.id('vandaag-plus-close'));
    await openPlus();
    // the last assistant turn, read from the screen (its first words are the act's label, from the manifest)
    await soon(by.id('vandaag-plus-turn-assistant'), 15_000);
    const attrs = await element(by.id('vandaag-plus-turn-assistant')).getAttributes();
    const texts = (attrs.elements ?? [attrs]).map((a) => String(a.text ?? a.label ?? ''));
    if (!/niet bewaard|not saved/i.test(texts.at(-1) ?? '')) throw new Error(`the thread does not say the proposal was not saved: ${JSON.stringify(texts.slice(-2))}`);
    await device.takeScreenshot('plus-story-04-not-saved');
  });
});
