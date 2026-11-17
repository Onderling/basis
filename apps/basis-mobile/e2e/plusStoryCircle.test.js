/* global device, element, by, expect */
// THE "+" STORY ON THE PHONE, A CIRCLE'S ACT, with a REAL second person (e2e/support/relayPeer.mjs). Bram has a circle
// with lists on and a Boodschappen list; the phone joins it and makes an own list of the same name. "zet kaas op
// Boodschappen" is then a line two places can take: the "+" shows a card naming the act and the circle, nothing runs
// before the pick, and after it kaas is on Bram's list. No model is set: the plain reading finds it. Web twin:
// apps/basis/test-browser/plus-story-rest.spec.js (the circle's act). Release APK, an emulator or an agreed test device
// (E2E_WIPE_OK): it deletes the app.
//
// The relay runs on this laptop; both sides dial it as 127.0.0.1, and a phone on USB reaches it through `adb reverse`.

const { launch, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite, peerListsHold, listsTabReached } = require('./support/peer');
const { pause, present, openPlus, say } = require('./support/plusWalk');
const { reversePort } = require('./support/standInModel');

const LIST = 'Boodschappen';
const CIRCLE = 'Plus Kring';
let peer = null;
let ready = null;

describe('the "+" story on the phone: a circle\'s act asks which place, and runs only after the pick', () => {
  beforeAll(async () => {
    emulatorOnly('plusStoryCircle');
    peer = await startPeer(['--talk', '--features', 'lists', '--circle', CIRCLE, '--phone-host', '127.0.0.1']);
    ready = peer.ready;
    const port = Number(new URL(peer.relayUrl).port);
    reversePort(port, port);
    await launch({ fresh: true });
    await firstBoot();
  });
  afterAll(async () => { peer?.stop(); });

  it("the phone joins Bram's circle; Bram makes Boodschappen; his lists setting reaches the phone", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'plus-circle-01-join' });
    peer.send({ do: 'list-create', list: LIST });
    await peer.next('list-created', () => true, 20_000);
    await listsTabReached(ready.circleId, 'plus-circle-01b-tabs');
  });

  it('7. an own list of the same name; the line two places can take gets a card; nothing runs before the pick', async () => {
    await openPlus();
    await say(`nieuwe lijst ${LIST}`);
    await present(by.id('vandaag-plus-turn-assistant'));
    // the circle's list has to be on the phone too, or the line has one place and runs at once: read until the card
    let card = false;
    for (let i = 0; i < 8 && !card; i += 1) {
      await element(by.id('vandaag-plus-line')).replaceText(`zet kaas op ${LIST}`);
      await expect(element(by.id('vandaag-plus-line'))).toHaveText(`zet kaas op ${LIST}`);
      await pause(1500);
      await tapSoon(by.id('vandaag-plus-read'));
      try { await soon(by.id('vandaag-plus-card'), 8_000); card = true; } catch { /* not yet two places */ }
      await device.takeScreenshot(`plus-circle-02-read-${i}`);
      if (!card) {
        const lists = await peerListsHold(peer, () => true, 1);
        if (lists.some((l) => l.list === LIST && l.entries.includes('kaas'))) throw new Error('kaas reached Bram without a card');
        await tapSoon(by.id('vandaag-plus-close'));
        await pause(5000);
        await openPlus();
      }
    }
    if (!card) throw new Error('the line never got the which-place card');
    await soon(by.id(`vandaag-plus-card-in-${ready.circleId}`), 5_000);
    const before = await peerListsHold(peer, () => true, 1);
    if (before.some((l) => l.list === LIST && l.entries.includes('kaas'))) throw new Error('kaas is on Bram\'s list before the pick');
    await tapSoon(by.id(`vandaag-plus-card-in-${ready.circleId}`));
    await peerListsHold(peer, (ls) => ls.some((l) => l.list === LIST && l.entries.includes('kaas')));
    await device.takeScreenshot('plus-circle-03-picked');
  });
});
