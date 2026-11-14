/* global device, element, by, waitFor */
// A circle's LISTS on the phone, with a REAL second person (e2e/support/relayPeer.mjs).
//
// In the alpha a circle's lists are reached from Vandaag: the person puts a lists block on their page, scoped to one
// circle (Customise → Lists → which circle); the circle's own ⋯ menu does not offer them (alphaSurface.js). Web twin:
// `vandaag-lists-block.spec.js`. Bram (a real agent node on a relay the emulator reaches) has a circle with lists
// switched on (his signed policy update). The phone joins by his invite and puts that circle's lists on Vandaag. Bram
// makes a list with an entry: the phone's block shows it. The phone ticks it off: Bram's store has it no longer open.
// Bram adds another: the phone's block shows that too. The phone types a line in the list's add field: Bram holds it.
// Each step leaves a screenshot. Release APK, emulator only.

const { launch, isVisible, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const LIST = 'Boodschappen';
const CIRCLE = 'Lijsten Kring';
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

/** Vandaag shows `text` (the block re-reads when the tab is shown again). */
async function vandaagShows(text, tries = 12) {
  for (let i = 0; i < tries; i += 1) {
    if (await isVisible(by.text(text))) return true;
    await new Promise((r) => setTimeout(r, 5000));
    await tapSoon(by.id('circle-tab-circles')).catch(() => {});
    await tapSoon(by.id('circle-tab-screens')).catch(() => {});
  }
  return false;
}

describe("a circle's lists on the phone's Vandaag — a real second person over the relay", () => {
  beforeAll(async () => {
    emulatorOnly('listsAgenda');
    peer = await startPeer(['--talk', '--features', 'lists', '--circle', CIRCLE]);
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

  it("puts the circle's lists on Vandaag: Customise → Lists → the circle", async () => {
    await tapSoon(by.id('circle-tab-screens'));
    await tapSoon(by.id('vandaag-customise'));
    // the sheet lists the page's blocks first; "add" is below them: scroll the sheet until it shows
    // (it sits at the sheet's foot, under the home bar: half of it showing is enough to tap)
    await waitFor(element(by.id('customise-add-lists'))).toBeVisible().whileElement(by.id('customise-scroll')).scroll(300, 'down');
    await element(by.id('customise-add-lists')).tap();
    await device.takeScreenshot('lists-02-added-block');
    // the new Lists block asks which circle: its own chip with the circle's name (other blocks name the circle too)
    const chip = by.text(CIRCLE).withAncestor(by.id('customise-type-lists'));
    await waitFor(element(chip)).toBeVisible().whileElement(by.id('customise-scroll')).scroll(150, 'up');
    await element(chip).tap();
    await device.takeScreenshot('lists-03-picked-circle');
    await tapSoon(by.id('customise-done'));
  });

  it("Bram makes a list with an entry: the phone's block shows it", async () => {
    peer.send({ do: 'list-create', list: LIST });
    await peer.next('list-created', () => true, 20_000);
    peer.send({ do: 'list-add', list: LIST, text: 'melk' });
    const added = await peer.next('list-added', () => true, 20_000);
    if (!added.ok) throw new Error(`Bram could not add: ${JSON.stringify(added.result)}`);
    const seen = await vandaagShows('melk');
    await device.takeScreenshot('lists-04-melk');
    if (!seen) throw new Error("Bram's entry never showed in the phone's lists block");
  });

  it('the phone ticks it off, and Bram has it no longer open', async () => {
    const lists = await bramHolds((ls) => ls.some((l) => l.list === LIST && l.ids?.melk));
    const id = lists.find((l) => l.list === LIST).ids.melk;
    await tapSoon(by.id(`row-act-${id}`));
    await device.takeScreenshot('lists-05-ticked');
    await bramHolds((ls) => ls.some((l) => l.list === LIST && !l.entries.includes('melk')));
  });

  it("Bram adds another entry, and it appears in the phone's block", async () => {
    peer.send({ do: 'list-add', list: LIST, text: 'brood' });
    await peer.next('list-added', () => true, 20_000);
    const seen = await vandaagShows('brood');
    await device.takeScreenshot('lists-06-brood');
    if (!seen) throw new Error("Bram's second entry never showed on the phone");
  });

  it("the phone adds a line under the list on Vandaag, and Bram holds it", async () => {
    const lists = await bramHolds((ls) => ls.some((l) => l.list === LIST && l.id));
    const listId = lists.find((l) => l.list === LIST).id;
    await soon(by.id(`list-add-input-${listId}`), 30_000);
    await element(by.id(`list-add-input-${listId}`)).replaceText('zeep');
    await tapSoon(by.id(`list-add-send-${listId}`));
    await bramHolds((ls) => ls.some((l) => l.list === LIST && l.entries.includes('zeep')));
    // and the person sees their own line on the list (the page repaints after the op)
    const seen = await vandaagShows('zeep');
    await device.takeScreenshot('lists-07-zeep-added');
    if (!seen) throw new Error("the phone's own line never showed in its lists block");
  });

  it("the circle's Lists tab (after Tasks) shows its lists, and a list made there reaches Bram", async () => {
    await tapSoon(by.id('circle-tab-circles'));
    await tapSoon(by.id(`circle-tile-${ready.circleId}`), 60_000);
    await tapSoon(by.id('circle-detail-tab-lists'), 30_000);
    await soon(by.text(LIST).withAncestor(by.id('circle-detail-lists')), 30_000);
    await device.takeScreenshot('lists-08-tab');
    await element(by.id('lists-new-input')).replaceText('Klusjes');
    await tapSoon(by.id('lists-create-list'));
    await soon(by.text('Klusjes').withAncestor(by.id('circle-detail-lists')), 30_000);
    await bramHolds((ls) => ls.some((l) => l.list === 'Klusjes'));
    await device.takeScreenshot('lists-09-made-in-tab');
  });
});
