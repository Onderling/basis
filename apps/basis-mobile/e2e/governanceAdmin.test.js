/* global device, element, by, waitFor */
// GOVERNANCE ON THE PHONE, THE ADMIN'S HALF (the function matrix's governance × mobile cell, its second story): the
// phone founds a circle and is its admin; Bram (e2e/support/relayPeer.mjs --join --talk: a real agent node on a relay
// the emulator reaches) joins from the phone's invite. The phone REMOVES Bram from its admin panel (the confirm the
// op declares), and Bram's own
// device drops the circle: read from Bram's own store, never from what the phone sent.
// (The REPORT half of this cell waits on a surface question: in the alpha the governance panel, the only place an
// admin sees a report, is trimmed from the circle's menu. Asked 2026-11-14.)
// Runs against the RELEASE APK; deletes the app, so emulator only. The member's half: governanceProposal.test.js.

const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, backToLauncher, emulatorOnly } = require('./support/ui');
const { startPeer } = require('./support/peer');

const NAME = `Beheer ${Date.now().toString(36)}`;
let peer = null;
let circleId = null;

/** The circle's ⋯ menu item, from the launcher. */
async function openFromMenu(token, screenId) {
  await backToLauncher();
  await tapSoon(by.id(`circle-tile-${circleId}`), 30_000);
  await tapSoon(by.id('circle-detail-more'), 30_000);
  await soon(by.id('circle-detail-more-menu'), 10_000);
  await element(by.id(`circle-detail-${token}`)).tap();
  await soon(by.id(screenId), 20_000);
}

describe('governance on the phone — the admin removes a member', () => {
  beforeAll(async () => {
    emulatorOnly('governanceAdmin');
    peer = await startPeer(['--join', '--talk', '--handle', 'bram']);
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it('the phone founds a circle and Bram joins from its invite', async () => {
    // right after launch an early tap can be swallowed while the start screen settles: tap until the wizard opens
    let wizard = false;
    for (let i = 0; i < 5 && !wizard; i += 1) {
      await tapSoon(by.id('circle-tab-circles'), 30_000);
      await tapSoon(by.id('launcher-new'), 30_000);
      wizard = (await firstOf([by.id('create-group-wizard')], 8_000)) === 0;
    }
    if (!wizard) throw new Error('Make a circle never opened the wizard');
    if (await isVisible(by.id('wizard-radio-household'))) await element(by.id('wizard-radio-household')).tap();
    await element(by.id('create-group-name')).typeText(NAME);
    await device.pressBack();   // the keyboard covers the handle field below
    if (await isVisible(by.id('wizard-handle'))) await element(by.id('wizard-handle')).replaceText('anna');
    await tapSoon(by.text('Household').withAncestor(by.id('create-group-kind')), 20_000);
    for (let i = 0; i < 6; i += 1) {
      if (await isVisible(by.id('create-group-create'))) break;
      await element(by.id('create-group-next')).tap();
      await new Promise((r) => setTimeout(r, 600));
    }
    await element(by.id('create-group-create')).tap();
    const first = await firstOf([by.id('relay-question'), by.id('invite-link')], 60_000);
    if (first === 0) {
      await element(by.id('relay-question-input')).replaceText(peer.ready.relayUrl);
      await tapSoon(by.id('relay-question-save'));
      await new Promise((r) => setTimeout(r, 2000));   // one modal closes as the next opens
    }
    await soon(by.id('invite-link'), 60_000);
    const link = String((await element(by.id('invite-link')).getAttributes())?.text ?? '').trim();
    if (!link.startsWith('onderling-')) throw new Error(`the invite card's link reads ${JSON.stringify(link)}`);
    peer.send({ do: 'join', invite: link });
    const joined = await peer.next('joined', () => true, 120_000);
    if (!joined.ok) throw new Error(`Bram could not join: ${joined.error}`);
    circleId = joined.circleId;
    await soon(by.id('invite-joined'), 60_000).catch(() => {});
    await device.takeScreenshot('gova-01-joined');
    await tapSoon(by.id('invite-close'));
  });

  it("the phone removes Bram from its admin panel; Bram's own device drops the circle", async () => {
    peer.send({ do: 'my-circles' });
    const before = await peer.next('my-circles', () => true, 30_000);
    if (!before.holds) throw new Error(`Bram's device does not hold the circle before the removal: ${JSON.stringify(before)}`);
    // Bram's row: the one remove control on the panel that is not the phone's own (its own row says leave). The roster
    // may not hold his row on the first open (his join is a statement that crosses first): reopen until it does.
    // by its words: the testID carries Bram's webid, which the walk does not know ("Remove admin role" is another text)
    const removeBtn = by.text('Remove').withAncestor(by.id('circle-admin'));
    let found = false;
    for (let i = 0; i < 6 && !found; i += 1) {
      await openFromMenu('admin', 'circle-admin');
      await waitFor(element(by.id('admin-loading'))).not.toExist().withTimeout(20_000);
      await device.takeScreenshot(`gova-02-admin-${i}`);
      found = (await firstOf([removeBtn], 8_000)) === 0;
    }
    if (!found) throw new Error('the admin panel never offered a remove control for Bram (see gova-02-admin-*)');
    await element(removeBtn).atIndex(0).tap();
    await tapSoon(by.text('Confirm'), 10_000);   // the confirm the op declares (a removal rotates the key)
    await device.takeScreenshot('gova-03-removed');
    let gone = false; let last = null;
    for (let i = 0; i < 24 && !gone; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      peer.send({ do: 'my-circles' });
      last = await peer.next('my-circles', () => true, 30_000);
      gone = !last.holds;
    }
    if (!gone) throw new Error(`Bram's device still holds the circle after the removal: ${JSON.stringify(last)}`);
  });
});
