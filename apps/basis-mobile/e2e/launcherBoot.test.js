/* global device, element, by, waitFor, expect */
// The launcher's boot, restart and composer, pinned on an emulator — the three checks the classic chat shell's specs
// made (cold boot, restart survival, a slash command's round trip), driven where a person now is: the circle launcher
// and a circle's composer.
//
//   1. A fresh install boots to the launcher: the first-run welcome, the recovery words once, then the help circle's
//      tile — and never the boot-failed state.
//   2. A restart lands on the same launcher straight away: no welcome, no recovery words (the identity survived).
//   3. A slash command typed into a circle's composer does what it says: `/settings` opens the circle's settings.
//
// Runs against the RELEASE APK (embedded JS bundle), like the rest of this suite.

const HELP_TILE = 'circle-tile-cc-help';   // the circle a fresh install always has (HELP_CIRCLE_ID = 'cc-help')

async function launch({ fresh }) {
  // The app's network timers never let RN idle; launch with synchronization off (see circleDefault.test.js).
  await device.launchApp({ newInstance: true, delete: !!fresh, launchArgs: { detoxEnableSynchronization: 0 } });
  await device.disableSynchronization();
}

async function isVisible(matcher) {
  try { await expect(element(matcher)).toBeVisible(); return true; } catch { return false; }
}

describe('the launcher boots, survives a restart, and its composer takes a slash command', () => {
  beforeAll(async () => {
    // This spec DELETES the app (a fresh install): emulator only, refused before the device is touched.
    if (!String(device.id ?? '').startsWith('emulator-')) {
      throw new Error(`launcherBoot refuses to run on ${device.id}: it deletes the app — emulator only`);
    }
  });

  it('a fresh install boots to the launcher and the help circle', async () => {
    await launch({ fresh: true });
    await waitFor(element(by.id('first-run-welcome'))).toBeVisible().withTimeout(90_000);
    await element(by.id('first-run-start')).tap();
    // the recovery words come once, not always first (see walkFixes20261008.test.js): confirm them whenever they show
    const until = Date.now() + 180_000;
    let tile = false;
    while (Date.now() < until && !tile) {
      if (await isVisible(by.id('launcher-boot-failed'))) throw new Error('first boot: the launcher says the boot failed');
      if (await isVisible(by.id('mnemonic-create'))) await element(by.id('mnemonic-create-written')).tap();
      tile = await isVisible(by.id(HELP_TILE));
      if (!tile) await new Promise((r) => setTimeout(r, 500));
    }
    if (!tile) throw new Error('first boot: the help circle never showed on the launcher (180 s)');
  });

  it('a restart lands on the launcher — no welcome, no recovery words', async () => {
    await launch({ fresh: false });
    const until = Date.now() + 90_000;
    let tile = false;
    while (Date.now() < until && !tile) {
      if (await isVisible(by.id('first-run-welcome'))) throw new Error('restart: the first-run welcome came back');
      if (await isVisible(by.id('mnemonic-create'))) throw new Error('restart: the recovery words came back');
      if (await isVisible(by.id('launcher-boot-failed'))) throw new Error('restart: the launcher says the boot failed');
      tile = await isVisible(by.id(HELP_TILE));
      if (!tile) await new Promise((r) => setTimeout(r, 250));
    }
    if (!tile) throw new Error('restart: the help circle never showed on the launcher (90 s)');
  });

  it("a circle's composer takes a slash command: /settings opens the circle's settings", async () => {
    await element(by.id('circle-tab-circles')).tap();
    await waitFor(element(by.id(HELP_TILE))).toBeVisible().withTimeout(30_000);
    await element(by.id(HELP_TILE)).tap();
    await waitFor(element(by.id('circle-detail-composer-input'))).toBeVisible().withTimeout(30_000);
    await element(by.id('circle-detail-composer-input')).replaceText('/settings');
    // the composer re-renders with its suggestion first: a send tapped before that lands on the old, empty state
    await waitFor(element(by.text('/settings').withAncestor(by.id('circle-detail-composer')))).toExist().withTimeout(5_000);
    await new Promise((r) => setTimeout(r, 800));
    await element(by.id('circle-detail-composer-send')).tap();
    // a built-in, not the bot: the settings screen opens (its back control is on screen)
    await waitFor(element(by.id('circle-settings-back'))).toBeVisible().withTimeout(15_000);
    await expect(element(by.text('Render Error'))).not.toExist();
  });
});
