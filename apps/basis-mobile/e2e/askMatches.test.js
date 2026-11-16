/* global device, element, by */
// Who offers what I asked — on the phone, with a REAL second person (e2e/support/relayPeer.mjs).
//
// Bram (a real agent node on a relay the emulator reaches) has a circle and offers "boormachine uitlenen", released
// to that circle. The phone opens his invite as a link and joins, asks the board for a boormachine, and sees Bram
// under its own ask with the offering he released. Ask opens the contact thread with him; Skip hides him on this
// phone. Each step leaves a screenshot. Runs against the RELEASE APK; deletes the app, so emulator only.

const { launch, isVisible, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const OFFERING = 'boormachine uitlenen';
// The match row's buttons, found inside the inline match list (a regex testID does not match on Android); the words are
// the English locale's, which the emulator runs.
const INLINE = by.id('circle-offering-matches-inline');
const ASK = by.text('Ask').withAncestor(INLINE);
const SKIP = by.text('Skip').withAncestor(INLINE);
let peer = null;
let ready = null;

describe('an ask on the phone shows who offers it — a real second person over the relay', () => {
  beforeAll(async () => {
    emulatorOnly('askMatches');
    peer = await startPeer(['--circle', 'Vraag Kring', '--offering', OFFERING]);
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle from his invite link", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'ask-01-join' });
  });

  it('asks the board, and sees Bram under its own ask with the offering he released', async () => {
    await tapSoon(by.id(`circle-tile-${ready.circleId}`));
    await tapSoon(by.id('circle-detail-tab-noticeboard'));
    await soon(by.id('nb-input'));
    // focus first: right after the join the input can be on screen before it takes a tap
    for (let i = 0; i < 4; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      await element(by.id('nb-input')).tap();
      await element(by.id('nb-input')).typeText('Heeft iemand een boormachine?');
      if (await isVisible(by.text('Heeft iemand een boormachine?'))) break;
      await element(by.id('nb-input')).clearText().catch(() => {});
    }
    await device.takeScreenshot('ask-02a-typed');
    await tapSoon(by.id('nb-post'));
    await new Promise((r) => setTimeout(r, 3000));
    await device.takeScreenshot('ask-02b-posted');
    // Bram's released offering reaches the phone's roster over the relay; the board re-reads on a revisit
    let seen = false;
    for (let i = 0; i < 12 && !seen; i += 1) {
      seen = await isVisible(by.text(OFFERING));
      if (!seen) {
        await new Promise((r) => setTimeout(r, 5000));
        await tapSoon(by.id('circle-detail-tab-members')).catch(() => {});
        await tapSoon(by.id('circle-detail-tab-noticeboard'));
      }
    }
    await device.takeScreenshot('ask-02-matches');
    if (!seen) throw new Error(`no match under the ask: "${OFFERING}" never showed`);
    await soon(by.id('circle-offering-matches-inline'));
  });

  it('Ask opens the contact thread with Bram', async () => {
    await tapSoon(ASK);
    await soon(by.id('contact-thread-screen'), 30_000);
    await device.takeScreenshot('ask-03-thread');
    await tapSoon(by.id('contact-thread-back'));
  });

  it('Skip hides Bram under the ask on this phone, and he stays hidden', async () => {
    // the thread lives under Contacts, so Back from it lands there: walk back into the circle's board
    if (!(await isVisible(INLINE))) {
      await tapSoon(by.id('circle-tab-circles'));
      await tapSoon(by.id(`circle-tile-${ready.circleId}`));
      await tapSoon(by.id('circle-detail-tab-noticeboard'));
    }
    await tapSoon(SKIP);
    await new Promise((r) => setTimeout(r, 2000));
    await tapSoon(by.id('circle-detail-tab-members')).catch(() => {});
    await tapSoon(by.id('circle-detail-tab-noticeboard'));
    await new Promise((r) => setTimeout(r, 3000));
    await device.takeScreenshot('ask-04-skipped');
    if (await isVisible(by.text(OFFERING))) throw new Error('the skipped match came back');
  });
});
