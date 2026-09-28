/**
 * A CAPABILITY THE ADMIN WITHHOLDS IS WITHHELD ON THE MEMBER'S DEVICE — every surface, one answer.
 *
 * The circle's capability matrix rides the policy, the policy rides the governance lane, and every surface that
 * offers an op asks the same fold (`opAvailability`: app · feature · capability, deny-wins). So when an admin
 * unticks one capability, the member's device must stop offering it everywhere at once — not on the surface
 * whose author happened to know about the matrix.
 *
 * Two web apps over a local relay. A makes a circle and turns tasks on; B joins. Baseline: B is offered claiming.
 * Then A withholds "claim a task":
 *   · with the consequence HIDDEN — B's reply to a new task carries no claim button, `/claim` is not suggested,
 *     and the task row in the Taken tab carries no claim chip;
 *   · with the consequence GREYED (the default) — the claim button and the task row's chip are there, disabled.
 *
 * The ⋯ menu holds only this device's own actions (settings, invite, …), never an app op like claiming, so it has
 * no entry to grey here; it asks the same fold, which the unit tests of the ⋯ roster pin.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-withheld-capability.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, log, enableFeature, openMore, reopenCircle, sendChat, openTakenTab } from './peerHarness.js';
import { circleIds } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const RE = /onthouden/i;

/** The stored capability row for claiming, as B's device holds it (null when the policy names none). */
const claimRowOn = (page, circleId) => page.evaluate((cid) => {
  try {
    const p = JSON.parse(localStorage.getItem(`cc.circlePolicy.${cid}`) || 'null');
    const hit = Object.entries(p?.capabilities ?? {}).find(([k]) => / claim task$/.test(k));
    return hit ? hit[1] : null;
  } catch { return null; }
}, circleId);

/** Is `/claim` among the composer's suggestions for "/cl"? */
async function claimSuggested(page) {
  const input = page.locator('.circle-view__composer-input');
  await input.fill('/cl');
  await page.waitForTimeout(600);
  const cmds = (await page.locator('.circle-view__suggest-cmd').allTextContents()).map((s) => s.trim());
  await input.fill('');
  return cmds.includes('/claim');
}

/** Add a task and read the claim button on the reply that names it: 'absent' · 'enabled' · 'disabled'. */
async function claimButtonOnReply(page, text) {
  await sendChat(page, `/addtask ${text}`, 4000);
  const btn = page.locator('.circle-view__embed-button[data-op-id="claimTask"]').filter({ hasText: new RegExp(text, 'i') });
  if (!(await btn.count())) return 'absent';
  return (await btn.last().isDisabled()) ? 'disabled' : 'enabled';
}

/** The capability matrix sits in the settings' folded "advanced" part. */
async function openAdvanced(page) {
  const adv = page.locator('details.circle-settings__advanced');
  if (await adv.count() && !(await adv.first().evaluate((d) => d.open))) await page.locator('.circle-settings__advanced-summary').first().click();
  await page.waitForTimeout(300);
}

/** Admin: open settings, set the claim row's consequence, untick it, save — the policy goes out on the lane. */
async function withholdClaim(page, consequence) {
  expect(await openMore(page, 'settings'), 'A opens settings').toBe(true);
  await openAdvanced(page);
  const row = page.locator('.circle-settings__cap-row').filter({ has: page.locator('input[data-role="enabled"]') })
    .and(page.locator('[data-cap$=" claim task"]'));
  expect(await row.count(), 'the matrix has a row for claiming a task').toBeGreaterThan(0);
  const en = row.first().locator('input[data-role="enabled"]');
  // The consequence only takes a value while the row is enabled — set it first, then withhold.
  if (!(await en.isChecked())) { await en.check(); await openAdvanced(page); }
  await row.first().locator('select[data-role="consequence"]').selectOption(consequence);
  await openAdvanced(page);   // a change re-renders the editor, folded again
  await en.uncheck();
  await page.locator('.circle-settings__save').first().click();
  await page.waitForTimeout(1800);
}

test('an admin withholds claiming — the member is not offered it, on any surface', async ({ browser }) => {
  test.setTimeout(600_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Onthouden', re: RE, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));

    await reopenCircle(A.page, RE);
    expect(await enableFeature(A.page, 'tasks'), 'A turns tasks on').toBe(true);

    // Baseline — B is offered claiming.
    await expect.poll(async () => { await reopenCircle(B.page, RE); return claimSuggested(B.page); },
      { timeout: 120_000, intervals: [5000], message: 'B is offered /claim once tasks are on' }).toBe(true);
    expect(await claimButtonOnReply(B.page, 'brood'), 'B\'s reply to a new task offers claiming').toBe('enabled');
    log('STEP1 baseline: B is offered claiming', 'PASS', '');

    // Withheld, hidden.
    await reopenCircle(A.page, RE);
    await withholdClaim(A.page, 'hidden');
    await expect.poll(async () => (await claimRowOn(B.page, circle))?.enabled ?? 'NO ROW',
      { timeout: 90_000, message: 'B holds the withheld capability' }).toBe(false);
    await reopenCircle(B.page, RE);
    expect(await claimSuggested(B.page), '/claim is not suggested').toBe(false);
    expect(await claimButtonOnReply(B.page, 'kaas'), 'no claim button on the reply').toBe('absent');
    const taken = await openTakenTab(B.page);
    expect(taken.present, 'B has a Taken tab').toBe(true);
    const chips = B.page.locator('.circle-view__task').filter({ hasText: /kaas/i })
      .locator('.circle-view__task-action, .circle-view__task-actions button').filter({ hasText: /ik doe|claim|oppak|neem/i });
    expect(await chips.count(), 'no claim chip on the task row').toBe(0);
    log('STEP2 withheld + hidden: gone from reply, slash, task row', 'PASS', '');

    // Withheld, greyed.
    await reopenCircle(A.page, RE);
    await withholdClaim(A.page, 'greyed');
    await expect.poll(async () => (await claimRowOn(B.page, circle))?.consequence ?? 'NO ROW',
      { timeout: 90_000, message: 'B holds the greyed consequence' }).toBe('greyed');
    await reopenCircle(B.page, RE);
    expect(await claimButtonOnReply(B.page, 'melk'), 'the claim button is greyed').toBe('disabled');
    await openTakenTab(B.page);
    const greyChip = B.page.locator('.circle-view__task').filter({ hasText: /melk/i }).locator('.circle-view__task-actions button[data-action="claim"]');
    expect(await greyChip.count(), 'the task row still shows its claim chip').toBeGreaterThan(0);
    expect(await greyChip.first().isDisabled(), '…greyed').toBe(true);
    log('STEP3 withheld + greyed: the button and the chip are there, disabled', 'PASS', '');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
