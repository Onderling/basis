// Wizard-launch smoke for the 6 new wizards added in Bundle F
// follow-up (2026-05-26). Mirror of disputeWizard.test.js but
// driven via slash commands — proves the slash → wizardModalFor →
// modal-open path that we wired into submitInput.
//
// Each test:
//   1. Types the slash that maps to a wizard opId
//   2. Asserts the modal's testID becomes visible
//   3. Cancels / dismisses cleanly
//
// We don't submit — that would need substrate state these tests
// don't bootstrap.  State-machine submission is verified by vitest.

const { gotoChat } = require('./support/nav.js');

// SKIPPED (Detox survey 2026-10-09): this spec drives the classic CHAT SHELL through `gotoChat()` — the launcher's "← chat" affordance (`circle-to-chat`) was removed, so that surface is unreachable for a person (CircleLauncherScreen.js: "no chat shell to navigate to"). On development @ ed1a25ddc every test here timed out in `gotoChat` waiting for `chat-header-status`. Not an app bug. Port what is still worth pinning to the circle composer before un-skipping.
describe.skip('Bundle F P2 — all-wizard launch smoke (via slash)', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await gotoChat();   // M2 — circle launcher is the default screen
  });

  async function launchViaSlash(slash, modalTestId) {
    // Clear the input first — Detox typeText appends.
    await element(by.id('chat-input')).clearText();
    await element(by.id('chat-input')).typeText(slash);
    await element(by.id('chat-send')).tap();
    await waitFor(element(by.id(modalTestId)))
      .toBeVisible()
      .withTimeout(10_000);
    // Cancel/dismiss.  Each wizard has a Cancel OR Done button on
    // step 1; both have testID `wizard-action-<label>`.
    try {
      await element(by.id('wizard-action-Cancel')).tap();
    } catch {
      await element(by.id('wizard-action-Done')).tap();
    }
    await waitFor(element(by.id(modalTestId)))
      .not.toBeVisible()
      .withTimeout(5_000);
  }

  it('/dispute opens the conflict-dispute wizard', async () => {
    await launchViaSlash('/dispute',                'conflict-dispute-wizard');
  });

  it('/create-group opens the createGroup wizard', async () => {
    await launchViaSlash('/create-group',           'create-group-wizard');
  });

  it('/restore-from-mnemonic opens the restore wizard', async () => {
    await launchViaSlash('/restore-from-mnemonic',  'restore-from-mnemonic-wizard');
  });

  it('/post-audience opens the postAudience wizard', async () => {
    await launchViaSlash('/post-audience',          'post-audience-wizard');
  });

  it('/encrypted-backup opens the encryptedBackup wizard', async () => {
    await launchViaSlash('/encrypted-backup',       'encrypted-backup-wizard');
  });

  it('/settings opens the settings wizard', async () => {
    await launchViaSlash('/settings',               'settings-wizard');
  });

  // embed-time launches the wizard on mobile
  // so the user can fill title/when/duration via a form instead of
  // typing slash flags.  The 'when' field accepts natural-language
  // dates via the chrono fallback added to localBuiltins.
  it('/embed-time opens the embedTime wizard', async () => {
    await launchViaSlash('/embed-time',             'embed-time-wizard');
  });

  // joinGroup needs an invite arg — a bare /join-group trips
  // needsForm (resolveDispatch sees the required param missing).
  // Pass garbage so resolveDispatch is `ready`, decodeInvite raises
  // a parse error, the modal renders the error screen.  Still proves
  // the slash → wizardModalFor → modal-open path.
  it('/join-group <bogus> opens the joinGroup wizard (parse-error screen)', async () => {
    await element(by.id('chat-input')).clearText();
    await element(by.id('chat-input')).typeText('/join-group not-a-real-invite');
    await element(by.id('chat-send')).tap();
    await waitFor(element(by.id('join-group-wizard')))
      .toBeVisible()
      .withTimeout(10_000);
    await element(by.id('wizard-action-Done')).tap();
    await waitFor(element(by.id('join-group-wizard')))
      .not.toBeVisible()
      .withTimeout(5_000);
  });
});
