// Slash command round-trip (D-1 test 2).
//
// Replaces the manual step-2 verification:
//   1. Type "/mine" into the chat input
//   2. Tap Send
//   3. A list bubble appears with at least one row showing a button
//      (household's markComplete is appliesTo: { type:'chore', state:'open' };
//      mockHouseholdManifest's default chores start in 'open' state so the
//      button lights up).
//
// This exercises the full dispatch pipeline end-to-end on real
// Hermes: parseInput → resolveDispatch → runDispatch (callSkill to
// household via InternalTransport) → renderReply (with the canonical
// opts that include manifestsByOrigin so inline keyboards populate).
//
// If buttonCount goes to 0 on regression, this test catches the
// "/mine works but no buttons" bug we hit 2026-05-26.

const { gotoChat } = require('./support/nav.js');

// SKIPPED (Detox survey 2026-10-09): this spec drives the classic CHAT SHELL through `gotoChat()` — the launcher's "← chat" affordance (`circle-to-chat`) was removed, so that surface is unreachable for a person (CircleLauncherScreen.js: "no chat shell to navigate to"). On development @ ed1a25ddc every test here timed out in `gotoChat` waiting for `chat-header-status`. Not an app bug. Port what is still worth pinning to the circle composer before un-skipping.
describe.skip('slash command round-trip', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Same as _hello.test.js — our app has perpetual background work
    // (NknTransport reconnect loop, periodic catch-up timers) so the
    // RN bridge never goes idle.  Detox would otherwise time out
    // waiting for sync between commands.  Disable sync BEFORE gotoChat
    // so its tap on "← chat" doesn't hang on the never-idle bridge.
    await device.disableSynchronization();
    // M2 — circle launcher is the default screen; reveal chat + wait
    // for the boot status.
    await gotoChat();
  });

  it('typing /mine + Send produces a list bubble with markComplete buttons', async () => {
    await element(by.id('chat-input')).typeText('/mine');
    await element(by.id('chat-send')).tap();

    // The household factory seeds 3 chores in state:'open' with ids
    // c-1, c-2, c-3 (see apps/basis/src/core/agent/mockAgent.js
    // line 31-33).  /mine returns listOpen → all three render with a
    // [Mark complete] button (id-format: list-row-btn-<opId>-<itemId>).
    // We pin the FIRST one rather than using a regex matcher because
    // Detox's regex-id support has known timing quirks.
    await waitFor(element(by.id('list-row-btn-markComplete-c-1')))
      .toBeVisible()
      .withTimeout(30_000);
  });
});
