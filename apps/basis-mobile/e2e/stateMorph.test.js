// State-morph assertion (Phase B D-2 test 3).
//
// Pins step 3 on the real device: after a row-button tap that
// mutates an item's state, the originating list bubble re-renders
// IN PLACE so the row's appliesTo-gated buttons re-match against
// the post-dispatch state.
//
// Concretely:
//   1. /mine renders the household list with 3 chores (c-1, c-2, c-3),
//      each carrying a [Mark complete] button (state:'open' triggers
//      markComplete's appliesTo).
//   2. Tap markComplete on c-1.
//   3. refreshList re-runs /mine; c-1 now state:'done', so its
//      markComplete button is GONE.  The other two rows keep theirs.
//
// Guards against the regression where refreshList silently drops or
// runs against stale snapshot state — D-1 only proves the FIRST
// render is correct.

const { gotoChat } = require('./support/nav.js');

// SKIPPED (Detox survey 2026-10-09): this spec drives the classic CHAT SHELL through `gotoChat()` — the launcher's "← chat" affordance (`circle-to-chat`) was removed, so that surface is unreachable for a person (CircleLauncherScreen.js: "no chat shell to navigate to"). On development @ ed1a25ddc every test here timed out in `gotoChat` waiting for `chat-header-status`. Not an app bug. Port what is still worth pinning to the circle composer before un-skipping.
describe.skip('state morph on row-button tap', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await gotoChat();   // M2 — circle launcher is the default screen
  });

  it('after tapping [Mark complete] on c-1, that row\'s button disappears (others remain)', async () => {
    // Same /mine setup as slashRoundtrip.test.js.
    await element(by.id('chat-input')).typeText('/mine');
    await element(by.id('chat-send')).tap();
    await waitFor(element(by.id('list-row-btn-markComplete-c-1')))
      .toBeVisible()
      .withTimeout(30_000);
    // Sanity: c-2 + c-3 also start with buttons.
    await expect(element(by.id('list-row-btn-markComplete-c-2'))).toBeVisible();
    await expect(element(by.id('list-row-btn-markComplete-c-3'))).toBeVisible();

    // Tap markComplete on c-1.  This goes through handleButtonTap →
    // dispatchAndAppend → refreshList (step 3) which re-runs
    // the originating /mine dispatch and rewrites the rendered list
    // in place.
    await element(by.id('list-row-btn-markComplete-c-1')).tap();

    // After refresh: c-1's button is gone (state:'done' no longer
    // matches markComplete's appliesTo), c-2 + c-3 keep theirs.
    await waitFor(element(by.id('list-row-btn-markComplete-c-1')))
      .not.toBeVisible()
      .withTimeout(15_000);
    await expect(element(by.id('list-row-btn-markComplete-c-2'))).toBeVisible();
    await expect(element(by.id('list-row-btn-markComplete-c-3'))).toBeVisible();
  });
});
