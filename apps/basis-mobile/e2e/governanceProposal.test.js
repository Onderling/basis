/* global device, element, by, waitFor, expect */
// GOVERNANCE ON THE PHONE: A MEMBER PROPOSES, THE ADMIN SAYS YES (the function matrix's governance × mobile cell).
//
// Bram (e2e/support/relayPeer.mjs: a real agent node on a relay the emulator reaches) founded a circle; the phone joins
// it from his invite as a member. A member's own statement of the circle's settings is dropped by every device, so the
// phone's Save on the settings screen is a PROPOSAL (the governance `changePolicy` action, signed as its self in the
// circle). Bram, the admin, takes it over (`gov-accept`: the governance binding the shells compose, a yes on the open
// settings proposal, the change stated on the lane). The phone then holds the circle's new settings: the switch it
// proposed reads on, from the circle's statement, not from its own Save.
// Runs against the RELEASE APK; deletes the app, so emulator only. The web twin: test-browser/walk-member-proposes-policy.

const { launch, soon, tapSoon, firstBoot, backToLauncher, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const FEATURE = 'lists';   // offered on the settings screen and off by default: the proposal turns it on
let peer = null;
let ready = null;

/** The circle's settings screen, from the launcher: the tile, its ⋯, Settings. */
async function openSettings() {
  await backToLauncher();
  await tapSoon(by.id(`circle-tile-${ready.circleId}`), 30_000);
  await tapSoon(by.id('circle-detail-more'), 30_000);
  await soon(by.id('circle-detail-more-menu'), 10_000);
  await element(by.id('circle-detail-settings')).tap();
  await soon(by.id('circle-settings'), 20_000);
}
/** Scroll the settings screen until the feature switch shows. */
async function featureSwitch() {
  await waitFor(element(by.id(`feat-${FEATURE}`))).toBeVisible().whileElement(by.id('circle-settings-scroll')).scroll(300, 'down');
  return element(by.id(`feat-${FEATURE}`));
}

describe('governance on the phone — a member proposes a settings change, the admin says yes', () => {
  beforeAll(async () => {
    emulatorOnly('governanceProposal');
    peer = await startPeer(['--circle', 'Voorstel Kring', '--talk']);   // --talk: the peer takes commands (gov-accept)
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle from his invite link, as a member", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'gov-01-join' });
  });

  it("the member's Save is a proposal: it changes nothing yet", async () => {
    await openSettings();
    const sw = await featureSwitch();
    await expect(sw).toHaveToggleValue(false);
    await sw.tap();
    await device.takeScreenshot('gov-02-proposed-change');
    await tapSoon(by.id('circle-settings-save'));   // below the scroll view, always on screen
    // the proposal went: back on the screen, the circle's settings are as they were (a proposal changes nothing yet)
    await openSettings();
    await expect(await featureSwitch()).toHaveToggleValue(false);
    await device.takeScreenshot('gov-03-unchanged');
  });

  it("Bram, the admin, says yes: the phone holds the circle's new settings", async () => {
    peer.send({ do: 'gov-accept' });
    const said = await peer.next('gov-accepted', () => true, 180_000);
    if (!said.ok) throw new Error(`Bram could not accept the proposal: ${JSON.stringify(said)}`);
    let on = false;
    for (let i = 0; i < 12 && !on; i += 1) {
      await openSettings();
      try { await expect(await featureSwitch()).toHaveToggleValue(true); on = true; } catch { await new Promise((r) => setTimeout(r, 5000)); }
    }
    await device.takeScreenshot('gov-04-adopted');
    if (!on) throw new Error(`the phone never held the accepted change (Bram's side: ${JSON.stringify(said)})`);
  });
});
