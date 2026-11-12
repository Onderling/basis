/* global device, element, by */
// A circle's LISTS on the phone, with a REAL second person (e2e/support/relayPeer.mjs).
//
// Bram (a real agent node on a relay the emulator reaches) has a circle with lists switched on (his signed policy
// update). The phone joins by his invite, opens the circle's lists from the ⋯ menu, makes a list and adds an entry;
// Bram's own store holds it. Bram adds an entry; the phone shows it on the same list. Each step leaves a screenshot.
// Runs against the RELEASE APK; deletes the app, so emulator only.

const { launch, isVisible, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const LIST = 'Boodschappen';
let peer = null;
let ready = null;

/** Bram's own lists, asked until `pred` holds (the phone's write crosses the relay). */
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

describe("a circle's lists on the phone — a real second person over the relay", () => {
  beforeAll(async () => {
    emulatorOnly('listsAgenda');
    peer = await startPeer(['--talk', '--features', 'lists', '--circle', 'Lijsten Kring']);
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle from his invite link", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'lists-01-join' });
  });

  it('opens the circle\'s lists from the ⋯ menu (lists are on: Bram\'s policy reached the phone)', async () => {
    await tapSoon(by.id(`circle-tile-${ready.circleId}`));
    let open = false;
    for (let i = 0; i < 10 && !open; i += 1) {
      await tapSoon(by.id('circle-detail-more'));
      open = await isVisible(by.id('circle-detail-lists'));
      if (!open) {
        await tapSoon(by.id('circle-detail-more'));   // close, wait for the policy to land, try again
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    await device.takeScreenshot('lists-02-menu');
    if (!open) throw new Error('no Lists entry in the ⋯ menu: the circle\'s lists never switched on here');
    await tapSoon(by.id('circle-detail-lists'));
    await soon(by.id('circle-lists'));
  });

  it('makes a list and adds an entry; Bram holds both', async () => {
    await soon(by.id('lists-new-input'));
    await element(by.id('lists-new-input')).tap();
    await element(by.id('lists-new-input')).typeText(LIST);
    await tapSoon(by.id('lists-create-list'));
    await tapSoon(by.text(LIST));
    await soon(by.id('lists-add-input'));
    await element(by.id('lists-add-input')).tap();
    await element(by.id('lists-add-input')).typeText('melk');
    await tapSoon(by.id('lists-add-submit'));
    await soon(by.text('melk'));
    await device.takeScreenshot('lists-03-added');
    await bramHolds((ls) => ls.some((l) => l.list === LIST && l.entries.includes('melk')));
  });

  it("Bram adds an entry, and it appears on the phone's list", async () => {
    peer.send({ do: 'list-add', list: LIST, text: 'brood' });
    const added = await peer.next('list-added', () => true, 20_000);
    if (!added.ok) throw new Error(`Bram could not add: ${JSON.stringify(added.result)}`);
    let seen = false;
    for (let i = 0; i < 12 && !seen; i += 1) {
      seen = await isVisible(by.text('brood'));
      if (!seen) {
        await new Promise((r) => setTimeout(r, 5000));
        await tapSoon(by.id('lists-back')).catch(() => {});   // to the index and back: the list re-reads
        await tapSoon(by.text(LIST)).catch(() => {});
      }
    }
    await device.takeScreenshot('lists-04-bram');
    if (!seen) throw new Error("Bram's entry never showed on the phone's list");
  });
});
