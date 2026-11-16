/* global device, element, by, waitFor */
// THE FIRST-MESSAGE DOOR ON THE PHONE, with "people in my circles may write to me" OFF (decision 2026-11-12: the
// persona is the policy; off = a member's first private message is a request like anyone's). A fresh install joins
// Bram's circle, turns the choice off on its persona card (the person's editor, the header avatar) BEFORE anyone
// writes, and Bram's first private message then waits as a request: not in a thread until the person accepts it, and
// in his thread after. The "on" case (the default: a thread, no request) is walked in e2e/messaging.test.js.
// Runs against the RELEASE APK; deletes the app, so emulator only.
const { launch, soon, tapSoon, firstOf, firstBoot, backToLauncher, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const FIRST = `Mag ik iets vragen ${Date.now().toString(36)}`;
let peer = null;
let ready = null;

const toContacten = async () => {
  await tapSoon(by.id('circle-tab-circles'));
  await tapSoon(by.id('circle-tab-contacten'));
  await soon(by.id('contacts-screen'));
};

describe('the first-message door on the phone: a member asks first when the person chose so', () => {
  beforeAll(async () => {
    emulatorOnly('messagingRequest');
    peer = await startPeer(['--circle', 'Vraag Kring', '--talk']);
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle from his invite link", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'req-01-join' });
  });

  it('the person turns "people in my circles may write to me" off on their persona card', async () => {
    await backToLauncher();
    await tapSoon(by.id('header-avatar'), 20_000);
    await soon(by.id('circle-aboutme-panel'), 20_000);
    const off = by.id('mij-first-contact-default-circleMembersMayWrite-false');
    await waitFor(element(off)).toBeVisible().whileElement(by.id('mij-scroll')).scroll(300, 'down');
    await element(off).tap();
    await device.takeScreenshot('req-02-ask-first');
    await tapSoon(by.id('circle-aboutme-panel-close'));
  });

  it("Bram's first private message waits as a request: no thread until the person accepts", async () => {
    peer.send({ do: 'contact-say', text: FIRST });
    const said = await peer.next('contact-said', () => true, 60_000);
    if (!said.ok) throw new Error(`Bram could not write: ${JSON.stringify(said)}`);
    let held = false;
    for (let i = 0; i < 8 && !held; i += 1) {
      await toContacten();
      held = (await firstOf([by.id('contacts-requests')], 5_000)) === 0;
    }
    await device.takeScreenshot('req-03-request');
    if (!held) throw new Error("Bram's first message never showed as a request");
    await soon(by.text(FIRST).withAncestor(by.id('contacts-requests')), 20_000);
  });

  it('accepted, his message stands in his thread', async () => {
    await element(by.text('Accept').withAncestor(by.id('contacts-requests'))).tap();
    let row = -1;
    for (let i = 0; i < 8 && row < 0; i += 1) {
      await toContacten();
      row = await firstOf([by.text('bram'), by.text('Bram')], 5_000);
    }
    if (row < 0) throw new Error('Bram never showed in Contacten after the request was accepted');
    await element(row === 0 ? by.text('bram') : by.text('Bram')).atIndex(0).tap();
    await soon(by.id('contact-thread-screen'), 30_000);
    await soon(by.text(FIRST), 60_000);
    await device.takeScreenshot('req-04-accepted');
  });
});
