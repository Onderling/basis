/* global device, element, by, expect */
// THE "+" ACTS IN A CIRCLE WHERE THE CIRCLE IS CLEAR, on the phone, with a REAL second person (e2e/support/relayPeer.mjs).
//
// Bram has a circle with lists on and a Boodschappen list. The phone joins it. In the "+" the person types "zet melk op
// de boodschappen": one of their circles holds that list (their Help circle does not), so it runs there at once, as
// them, and the sheet says what it did. Bram's own store has melk on Boodschappen. Web twin:
// apps/basis/test-browser/plus-circle-act.spec.js. Release APK, emulator only.

const { launch, isVisible, soon, tapSoon, firstBoot, backToLauncher, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite, peerListsHold, listsTabReached } = require('./support/peer');

const LIST = 'Boodschappen';
const CIRCLE = 'Plus Kring';
let peer = null;

/**
 * Type into the "+" line the way a person's keyboard does: through the device's input method (`adb shell input text`).
 * Detox's typeText and replaceText put the words in the native field without this sheet's onChangeText ever firing
 * (measured 2026-11-14 with a probe: no change event, and the read got an empty line), so the walk read "I could not
 * read that." while the product, typed into for real, ran the line. Emulator only, as this walk is.
 */
async function typeLine(text) {
  const { execFileSync } = require('node:child_process');
  await element(by.id('vandaag-plus-line')).clearText();
  await element(by.id('vandaag-plus-line')).tap();
  await new Promise((r) => setTimeout(r, 2000));   // the keyboard up and the field focused before the keys come
  const serial = process.env.ANDROID_SERIAL || 'emulator-17110';
  execFileSync('adb', ['-s', serial, 'shell', 'input', 'text', text.replace(/ /g, '%s')]);
  await new Promise((r) => setTimeout(r, 1500));
  // the words are in the line before Read (a probe that cannot say this would blame the read)
  await expect(element(by.id('vandaag-plus-line'))).toHaveText(text);
}
let ready = null;

const bramHolds = (pred) => peerListsHold(peer, pred);

describe('the "+" on the phone acts in the one circle that holds the list', () => {
  beforeAll(async () => {
    emulatorOnly('plusCircleAct');
    peer = await startPeer(['--talk', '--features', 'lists', '--circle', CIRCLE]);
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle, and Bram makes a Boodschappen list", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'plus-01-join' });
    peer.send({ do: 'list-create', list: LIST });
    await peer.next('list-created', () => true, 20_000);
  });

  it("the policy reached the phone: Bram's circle shows its Lists tab", async () => {
    await listsTabReached(ready.circleId, 'plus-01b-tabs');
    await backToLauncher();   // out of the circle: the tab bar (Today, where the "+" is) shows again
  });

  it('"zet melk op de boodschappen" in the "+" runs in that circle and says so; Bram holds melk', async () => {
    await tapSoon(by.id('circle-tab-screens'));
    // the list has to reach the phone first. Until it has, no circle HOLDS Boodschappen and the tasks phrasing reads the
    // line as a task in every circle, so the card asks which: Cancel, wait, read again. Once it is there, it runs at once.
    let did = false; let cards = 0;
    for (let i = 0; i < 10 && !did; i += 1) {
      await tapSoon(by.id('vandaag-plus-open'), 30_000);
      await soon(by.id('vandaag-plus-line'), 20_000);
      await typeLine('zet melk op de boodschappen');
      await tapSoon(by.id('vandaag-plus-read'));
      await new Promise((r) => setTimeout(r, 3000));
      await device.takeScreenshot(`plus-02-read-${i}`);   // what the sheet said to this read, whichever branch
      // the act ran when no card asks and the thread answered (the answer is said once, in the thread); Bram's own
      // store below is the proof that it landed
      did = !(await isVisible(by.id('vandaag-plus-card'))) && (await isVisible(by.id('vandaag-plus-thread')));
      if (!did) {
        if (await isVisible(by.id('vandaag-plus-card'))) { cards += 1; await tapSoon(by.id('vandaag-plus-card-no')); }
        await tapSoon(by.id('vandaag-plus-close'));
        await new Promise((r) => setTimeout(r, 6000));
      }
    }
    await device.takeScreenshot('plus-02-done');
    if (!did) throw new Error(`the "+" never ran the line in the circle (${cards} reads ended in the which-circle card: the list never reached the phone?)`);
    await bramHolds((ls) => ls.some((l) => l.list === LIST && l.entries.includes('melk')));
  });

  // THE KEPT CONVERSATION (the function matrix's assistant × mobile cell: the assistant since L668 is this "+" thread,
  // read on the device): what the person typed and what the "+" answered are still there after the sheet closed
  it('closed and opened again, the "+" still shows the line and its answer: the conversation is kept', async () => {
    await tapSoon(by.id('vandaag-plus-close'));
    await tapSoon(by.id('vandaag-plus-open'), 30_000);
    await soon(by.text('zet melk op de boodschappen').withAncestor(by.id('vandaag-plus')), 20_000);
    await soon(by.id('vandaag-plus-turn-assistant'), 10_000);
    await device.takeScreenshot('plus-03-kept');
  });

  it('a line the word rule does not know, with no model set, gets a plain answer, never silence', async () => {
    await typeLine('flubber quaxel');
    await tapSoon(by.id('vandaag-plus-read'));
    // the answer: no model is set, and where to set one, in the screens' own labels
    // the exact answer, from the same locale file and the same labels the app joins (English on the test phone), said
    // once: in the thread, as the assistant's turn (the sheet no longer repeats it on a line below)
    const en = require('../../basis/src/locales/circle.en.json');
    const txt = (v) => (typeof v === 'string' ? v : v.text);
    const path = [en.tab.mij, en.settings_home.title, en.settings_home.appearance, en.userLlm.title].map(txt).join(' \u2192 ');
    await soon(by.text(txt(en.vandaag.plus_no_model).replace('{{path}}', path)).withAncestor(by.id('vandaag-plus-thread')), 20_000);
    await device.takeScreenshot('plus-04-unread');
  });

  it('Forget empties the conversation', async () => {
    await tapSoon(by.id('vandaag-plus-forget'));
    await new Promise((r) => setTimeout(r, 1500));
    if (await isVisible(by.id('vandaag-plus-turn-you'))) throw new Error('Forget left the person\'s turns in the "+"');
    await tapSoon(by.id('vandaag-plus-close'));
    await tapSoon(by.id('vandaag-plus-open'), 30_000);
    await soon(by.id('vandaag-plus-line'), 20_000);
    if (await isVisible(by.id('vandaag-plus-turn-you'))) throw new Error('the forgotten turns came back when the "+" opened again');
    await device.takeScreenshot('plus-05-forgotten');
  });
});
