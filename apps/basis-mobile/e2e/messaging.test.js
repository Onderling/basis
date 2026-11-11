/* global device, element, by */
// MESSAGING ON THE PHONE, end to end with a real second person (the function matrix's messaging × mobile cell).
//
// Bram (e2e/support/relayPeer.mjs --talk: a real agent node on a relay the emulator reaches) has a circle. The phone
// opens his invite as a link and joins through the wizard. Then two round trips, each checked on BOTH sides:
//   1. in the circle: the phone sends a line from the circle's composer; Bram's chat log has it. Bram answers; the line
//      shows in the phone's circle chat.
//   2. in the contact thread: Bram writes to the phone directly; it shows in the phone's thread with him (found under
//      Contacten). The phone answers there; Bram's stored thread has it.
// Bram's side is read from his own stores (his chat log, his stored contact thread), never from what was sent.
// Runs against the RELEASE APK; deletes the app, so emulator only.

const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, backToLauncher, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const stamp = Date.now().toString(36);
const PHONE_LINE = `hallo kring ${stamp}`;
const PEER_LINE = `hoi anna ${stamp}`;
const PEER_DM = `even apart ${stamp}`;
const PHONE_DM = `prima ${stamp}`;
let peer = null;
let ready = null;

/** Type a line and send it the way a person does: the field submits on the return key (the gotchas file). */
async function say(inputId, text) {
  await soon(by.id(inputId));
  for (let i = 0; i < 3; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    await element(by.id(inputId)).tap();
    await element(by.id(inputId)).typeText(`${text}\n`);
    await new Promise((r) => setTimeout(r, 1500));
    // sent = the field is empty again; a lost submit leaves the text in it
    if (!(await isVisible(by.text(text).withAncestor(by.id(inputId))))) return;
    await element(by.id(inputId)).clearText().catch(() => {});
  }
  throw new Error(`the line never left ${inputId}`);
}

describe('messaging on the phone — a circle round trip and a contact round trip with a real second person', () => {
  beforeAll(async () => {
    emulatorOnly('messaging');
    peer = await startPeer(['--circle', 'Praat Kring', '--talk']);
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle from his invite link", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'msg-01-join' });
  });

  it("a line the phone sends in the circle reaches Bram's chat log", async () => {
    await tapSoon(by.id(`circle-tile-${ready.circleId}`));
    await soon(by.id('circle-detail-composer'), 30_000);
    await say('circle-detail-composer-input', PHONE_LINE);
    await device.takeScreenshot('msg-02-circle-sent');
    await peer.next('circle-heard', (m) => m.text === PHONE_LINE, 60_000);
  });

  it("Bram's answer in the circle shows in the phone's circle chat", async () => {
    peer.send({ do: 'circle-say', text: PEER_LINE });
    const said = await peer.next('circle-said');
    if (!said.ok) throw new Error(`Bram could not say it: ${said.error}`);
    await soon(by.text(PEER_LINE), 60_000);
    await device.takeScreenshot('msg-03-circle-answer');
  });

  it("Bram writes to the phone directly; it shows in the phone's thread with him", async () => {
    peer.send({ do: 'contact-say', text: PEER_DM });
    const said = await peer.next('contact-said', () => true, 60_000);
    if (!said.ok) throw new Error(`Bram could not write: ${JSON.stringify(said)}`);
    // the thread lives under Contacten; the list does not refresh in place (gotchas), so re-open it until Bram is there
    // the circle's chat hides the tab bar: step back out of it first
    await backToLauncher();
    let row = -1;
    for (let i = 0; i < 8 && row < 0; i += 1) {
      await tapSoon(by.id('circle-tab-circles'));
      await tapSoon(by.id('circle-tab-contacten'));
      await soon(by.id('contacts-screen'));
      row = await firstOf([by.text('bram'), by.text('Bram')], 5_000);
    }
    await device.takeScreenshot('msg-04-contacts');
    if (row < 0) throw new Error('Bram never showed in Contacten after his direct message');
    await element(row === 0 ? by.text('bram') : by.text('Bram')).atIndex(0).tap();
    await soon(by.id('contact-thread-screen'), 30_000);
    await soon(by.text(PEER_DM), 60_000);
    await device.takeScreenshot('msg-05-thread');
  });

  it("the phone's answer in the thread reaches Bram's stored thread", async () => {
    await say('contact-thread-input', PHONE_DM);
    await device.takeScreenshot('msg-06-thread-answer');
    try { await peer.next('contact-heard', (m) => m.text === PHONE_DM, 60_000); }
    catch (err) {
      // name the branch: did nothing arrive, did it fall to no handler, or was it refused?
      peer.send({ do: 'dump' });
      const dump = await peer.next('dump', () => true, 10_000).catch(() => null);
      throw new Error(`${err.message}\nBram holds: ${JSON.stringify(dump)}\nBram is: ${JSON.stringify(ready.addresses)}`);
    }
  });
});
