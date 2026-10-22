/* global device, element, by */
// Who offers what I asked — on the phone, with a REAL second person (e2e/support/relayPeer.mjs).
//
// Bram (a real agent node on a relay the emulator reaches) has a circle and offers "boormachine uitlenen", released
// to that circle. The phone opens his invite as a link and joins, asks the board for a boormachine, and sees Bram
// under its own ask with the offering he released. Ask opens the contact thread with him; Skip hides him on this
// phone. Each step leaves a screenshot. Runs against the RELEASE APK; deletes the app, so emulator only.

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, emulatorOnly } = require('./support/ui');

const OFFERING = 'boormachine uitlenen';
// The match row's buttons, found inside the inline match list (a regex testID does not match on Android); the words are
// the English locale's, which the emulator runs.
const INLINE = by.id('circle-offering-matches-inline');
const ASK = by.text('Ask').withAncestor(INLINE);
const SKIP = by.text('Skip').withAncestor(INLINE);
let peer = null;
let ready = null;

/** Start the second person and wait for its invite. */
function startPeer() {
  peer = spawn(process.execPath, [path.join(__dirname, 'support/relayPeer.mjs'), '--circle', 'Vraag Kring', '--offering', OFFERING],
    { cwd: path.join(__dirname, '..'), stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relayPeer: no invite within 120 s')), 120_000);
    readline.createInterface({ input: peer.stdout }).on('line', (line) => {
      let msg = null;
      try { msg = JSON.parse(line); } catch { return; }   // the agent's own logging shares stdout
      if (msg.step === 'error') { clearTimeout(timer); reject(new Error(`relayPeer: ${msg.error}`)); }
      if (msg.step === 'ready') { clearTimeout(timer); resolve(msg); }
    });
    peer.on('exit', (code) => { clearTimeout(timer); reject(new Error(`relayPeer exited (${code})`)); });
  });
}

describe('an ask on the phone shows who offers it — a real second person over the relay', () => {
  beforeAll(async () => {
    emulatorOnly('askMatches');
    ready = await startPeer();
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    try { peer?.stdin.end(); peer?.kill('SIGTERM'); } catch { /* already gone */ }
  });

  it("the phone joins Bram's circle from his invite link", async () => {
    await device.openURL({ url: ready.invite });
    // The wizard SLIDES in: a tap mid-slide lands nowhere and the box stays unticked (screenshot 2026-10-22). Settle,
    // tick, press Next — and tick again only while the next step has not come (a tick that took would be undone).
    const step = async (box, next) => {
      await soon(by.id(box), 60_000);
      for (let i = 0; i < 3; i += 1) {
        await new Promise((r) => setTimeout(r, 1500));
        await element(by.id(box)).tap();
        await tapSoon(by.id('join-next'));
        if (await firstOf([by.id(next)], 6_000) === 0) return;
      }
      throw new Error(`the join wizard did not move past ${box}`);
    };
    await step('join-rules-accept', 'join-privacy-accept');
    await step('join-privacy-accept', 'wizard-handle');
    if (await isVisible(by.id('wizard-handle'))) await element(by.id('wizard-handle')).replaceText('anna');
    await device.takeScreenshot('ask-01-join');
    await tapSoon(by.id('join-submit'));
    // the joined circle on the launcher
    await tapSoon(by.id('circle-tab-circles'), 60_000);
    await soon(by.id(`circle-tile-${ready.circleId}`), 90_000);
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
