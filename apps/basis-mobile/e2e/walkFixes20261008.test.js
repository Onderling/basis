/* global device, element, by, waitFor, expect */
// The three mobile fixes from the phone walk of 2026-10-08, pinned on an emulator so the next walk starts where that
// one ended. Each was found by hand on a real phone, after it had shipped:
//
//   1. Opening ANY circle painted a red screen ("Text strings must be rendered within a <Text> component") — three
//      spaces between `(<>` and a comment became a text node inside the circle screen's <View>.
//   2. On a cold start the launcher said "No circles yet." for seconds, for an account that HAD a circle — the empty
//      state painted in the gaps of its boot retry.
//   3. A contact's Hide / "What they see" / Delete lay past the right edge of the thread header — untappable.
//
// Runs against the RELEASE APK (embedded JS bundle), like the rest of this suite. A fresh install is enough: the app
// provisions its help circle on first boot (a circle to open), and a person is added by opening their card as a link.

const EMPTY = 'No circles yet.';
// A second PERSON, as the app's own encoder writes their card (e2e/support/makeContactCard.mjs; pinned by
// test/e2eContactCardFixture.test.js) — a person's thread carries Hide / "What they see" / Delete; a bot's does not.
const PERSON = require('./support/contactCard.fixture.json');
// The circle a fresh install always has: the help circle (its id is a product constant, HELP_CIRCLE_ID = 'cc-help').
const HELP_TILE = 'circle-tile-cc-help';

async function launch({ fresh }) {
  // The app's network timers never let RN idle; launch with synchronization off (see circleDefault.test.js).
  await device.launchApp({ newInstance: true, delete: !!fresh, launchArgs: { detoxEnableSynchronization: 0 } });
  await device.disableSynchronization();
}

async function isVisible(matcher) {
  try { await expect(element(matcher)).toBeVisible(); return true; } catch { return false; }
}

describe('the walk of 2026-10-08, pinned', () => {
  beforeAll(async () => {
    // This spec DELETES the app (a fresh install). It must never run on a person's phone: refuse anything that is not
    // an emulator before touching the device.
    if (!String(device.id ?? '').startsWith('emulator-')) {
      throw new Error(`walkFixes20261008 refuses to run on ${device.id}: it deletes the app — emulator only`);
    }
    await launch({ fresh: true });
    // A fresh install opens on the first-run welcome; the agent boots once the person starts.
    await waitFor(element(by.id('first-run-welcome'))).toBeVisible().withTimeout(90_000);
    await element(by.id('first-run-start')).tap();
    // …then the recovery words are shown once (a throwaway identity on the emulator): confirm and go on.
    await waitFor(element(by.id('mnemonic-create'))).toBeVisible().withTimeout(60_000);
    await element(by.id('mnemonic-create-written')).tap();
    // First boot: the launcher, then the help circle's tile once the agent has provisioned it.
    await waitFor(element(by.id('circle-launcher'))).toBeVisible().withTimeout(90_000);
    await waitFor(element(by.id(HELP_TILE)).atIndex(0)).toBeVisible().withTimeout(90_000);
  });

  it('a PERSON\'s Hide, "What they see" and Delete are on the screen', async () => {
    // First, straight after the fresh install: it is the one test that adds data.
    await waitFor(element(by.id('circle-tab-contacten'))).toBeVisible().withTimeout(30_000);
    await element(by.id('circle-tab-contacten')).tap();
    await waitFor(element(by.id('contacts-screen'))).toBeVisible().withTimeout(30_000);
    // The card arrives the way a person gets one — opened as a link (scanned or tapped), not typed: Detox typing a
    // 100-character code into the soft keyboard got mangled. The app's own link path (classifyQrPayload) takes it.
    await device.openURL({ url: PERSON.uri });
    // adding a person may first ask what they will see of you
    try {
      await waitFor(element(by.id('contact-add-sheet'))).toBeVisible().withTimeout(15_000);
      // The sheet SLIDES in: Detox calls it visible mid-slide, and a tap then can land on the backdrop — which
      // cancels and adds nothing. Let it settle, tap, and tap again while it is still up.
      for (let i = 0; i < 3 && (await isVisible(by.id('contact-add-sheet'))); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        await element(by.text('Add').withAncestor(by.id('contact-add-sheet'))).tap();
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch { /* this path adds without the sheet */ }
    // The link path lands in a circle's conversation (the app's chat confirms the add there); step back out to the
    // launcher. Back only while the tab bar is gone, so it never leaves the app.
    for (let i = 0; i < 3 && !(await isVisible(by.id('circle-tab-contacten'))); i++) {
      await device.pressBack();
      await new Promise((r) => setTimeout(r, 1500));
    }
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      await element(by.id('circle-tab-circles')).tap();
      await element(by.id('circle-tab-contacten')).tap();
      await new Promise((r) => setTimeout(r, 2500));
      found = await isVisible(by.text(PERSON.name));
    }
    if (!found) throw new Error(`${PERSON.name}'s card was added but never appeared in Contacts (polled ~60 s)`);
    await element(by.text(PERSON.name)).tap();
    await waitFor(element(by.id('contact-thread-actions'))).toBeVisible().withTimeout(30_000);
    // Visible = at least 75% of each control on the screen — what "reachable" means for a thumb.
    for (const id of ['contact-thread-hide', 'contact-thread-lens', 'contact-thread-delete']) {
      await expect(element(by.id(id))).toBeVisible();
    }
  });

  it('a cold start never says "No circles yet." to an account that has a circle', async () => {
    await launch({ fresh: false });
    await waitFor(element(by.id('circle-launcher'))).toBeVisible().withTimeout(90_000);
    // Watch the launcher until the tile is there: the empty state must not appear at any point on the way.
    const until = Date.now() + 90_000;
    let tile = false;
    while (Date.now() < until) {
      if (await isVisible(by.text(EMPTY))) throw new Error(`"${EMPTY}" painted for an account that has a circle`);
      if (await isVisible(by.id(HELP_TILE))) { tile = true; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!tile) throw new Error('the circle tile never appeared');
  });

  it('a circle opens — the conversation and its composer, no red screen', async () => {
    await waitFor(element(by.id(HELP_TILE))).toBeVisible().withTimeout(90_000);
    await element(by.id(HELP_TILE)).tap();
    await waitFor(element(by.id('circle-detail'))).toBeVisible().withTimeout(30_000);
    await waitFor(element(by.id('circle-detail-composer'))).toBeVisible().withTimeout(30_000);
    await expect(element(by.text('Render Error'))).not.toExist();
  });

});
