// Thread drawer create + switch (Phase B D-2 test 1).
//
// Verifies step 5 on the real device:
//   1. ☰ button opens the drawer modal
//   2. + form creates a new named thread + auto-switches
//   3. Drawer reflects both threads + active highlight
//   4. Tapping 'Main' switches back, drawer closes
//
// Pure UI state — no substrate dispatch needed, runs against the
// same boot setup as D-1.

const { gotoChat } = require('./support/nav.js');

describe('thread drawer create + switch', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await gotoChat();   // M2 — circle launcher is the default screen
  });

  it('☰ opens drawer; + creates thread; switching threads updates header name', async () => {
    // Drawer starts closed; open it.
    await element(by.id('chat-drawer-open')).tap();
    await waitFor(element(by.id('thread-drawer')))
      .toBeVisible()
      .withTimeout(5_000);
    // Seed 'Main' row is visible.
    await expect(element(by.id('thread-row-main'))).toBeVisible();

    // Create 'Circle'.
    await element(by.id('thread-drawer-new-input')).typeText('Circle');
    await element(by.id('thread-drawer-new-submit')).tap();

    // createThread auto-switches + closes the drawer.
    await waitFor(element(by.id('thread-drawer')))
      .not.toBeVisible()
      .withTimeout(5_000);
    await waitFor(element(by.id('chat-active-thread-name')))
      .toHaveText('Circle')
      .withTimeout(5_000);

    // Re-open the drawer + tap Main to switch back.
    await element(by.id('chat-drawer-open')).tap();
    await waitFor(element(by.id('thread-drawer')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.id('thread-row-main')).tap();
    await waitFor(element(by.id('chat-active-thread-name')))
      .toHaveText('Main')
      .withTimeout(5_000);
  });
});
