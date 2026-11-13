/* global device, element, by */
// THE "+" ACTS IN A CIRCLE WHERE THE CIRCLE IS CLEAR, on the phone, with a REAL second person (e2e/support/relayPeer.mjs).
//
// Bram has a circle with lists on and a Boodschappen list. The phone joins it. In the "+" the person types "zet melk op
// de boodschappen": one of their circles holds that list (their Help circle does not), so it runs there at once, as
// them, and the sheet says what it did. Bram's own store has melk on Boodschappen. Web twin:
// apps/basis/test-browser/plus-circle-act.spec.js. Release APK, emulator only.

const { launch, isVisible, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const LIST = 'Boodschappen';
const CIRCLE = 'Plus Kring';
let peer = null;
let ready = null;

/** Bram's own lists, asked until `pred` holds (a write crosses the relay). */
async function bramHolds(pred, tries = 20) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    peer.send({ do: 'lists-dump' });
    last = (await peer.next('lists', () => true, 20_000)).lists;
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Bram never held it; his lists: ${JSON.stringify(last)}`);
}

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

  it('"zet melk op de boodschappen" in the "+" runs in that circle and says so; Bram holds melk', async () => {
    await tapSoon(by.id('circle-tab-screens'));
    // the list has to reach the phone first. Until it has, no circle HOLDS Boodschappen and the tasks phrasing reads the
    // line as a task in every circle, so the card asks which: Cancel, wait, read again. Once it is there, it runs at once.
    let did = false; let cards = 0;
    for (let i = 0; i < 10 && !did; i += 1) {
      await tapSoon(by.id('vandaag-plus-open'), 30_000);
      await soon(by.id('vandaag-plus-line'), 20_000);
      await element(by.id('vandaag-plus-line')).replaceText('zet melk op de boodschappen');
      await tapSoon(by.id('vandaag-plus-read'));
      await new Promise((r) => setTimeout(r, 3000));
      did = await isVisible(by.id('vandaag-plus-done'));
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
});
