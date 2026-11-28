/**
 * A LATE JOINER HOLDS THE SETTINGS THE CIRCLE VOTED. A founds a circle alone and lets the MEMBERS decide its settings
 * (the settings screen's "who decides"). Then A turns a feature on: under that rule the Save is a proposal, and A's own
 * yes (one of one) carries it. Only then does B join. B's device judges every settings change itself (the receiver
 * gate): the change names its proposal, so B must hold that proposal and its votes, or it refuses a change the circle
 * made properly and shows the circle without the feature (seen on two phones, 2026-11-27: no Tasks tab, and the
 * Decisions screen saying the admin changed the settings without the vote).
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8796 npx playwright test --project=relay test-browser/walk-late-joiner-voted-settings.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, createCircle, openCircleMatching, getInvite, joinFromInvite, openMore, log } from './peerHarness.js';
import { circleIds } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_PORT + PEER_TEST_RELAY');
test.setTimeout(480_000);

const stamp = Date.now().toString(36);
const CIRCLE = `Stemkring ${stamp}`;
const RE = new RegExp(`Stemkring ${stamp}`, 'i');
const open = async (page) => { await gotoCircles(page); await openCircleMatching(page, RE); };
const policyOf = (page, cid) => page.evaluate(async (c) => { try { return await window.onderlingCirclePolicy?.get(c); } catch { return null; } }, cid);

test('a person who joins after a voted settings change holds that change, and nothing says it skipped the vote', async ({ browser }) => {
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    await gotoCircles(A.page);
    await createCircle(A.page, CIRCLE);
    await open(A.page);
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    expect(circle, 'A is in the circle').toBeTruthy();

    // A: the members decide the settings (a change of who decides, made while any admin decides: it stands)
    expect(await openMore(A.page, 'governance'), 'the Decisions entry is in the menu').toBe(true);
    const who = A.page.locator('.circle-governance__setting[data-action="changePolicy"] select');
    await expect(who).toBeVisible({ timeout: 20_000 });
    await who.selectOption('member-vote');
    await A.page.waitForTimeout(1500);
    await A.page.locator('.cc-governance__back').click();
    await expect.poll(async () => (await policyOf(A.page, circle))?.governance?.changePolicy, { timeout: 30_000 }).toBe('member-vote');
    log('STEP1 the members decide the settings', 'PASS', '');

    // A turns a feature on: a proposal now, carried by A's own yes (one member, one vote)
    await open(A.page);
    expect(await openMore(A.page, 'settings')).toBe(true);
    const box = A.page.locator('input[data-feature]:not([data-feature="chat"])').first();
    const feature = await box.getAttribute('data-feature');
    const want = !(await box.isChecked());
    if (want) await box.check(); else await box.uncheck();
    await expect(A.page.locator('.circle-settings__save')).toBeEnabled();
    await A.page.locator('.circle-settings__save').click();
    await A.page.waitForTimeout(1500);
    await expect.poll(async () => {
      if ((await policyOf(A.page, circle))?.features?.[feature] === want) return 'on';
      await open(A.page);
      await openMore(A.page, 'settings');
      const yes = A.page.locator('.circle-settings__proposal-yes');
      if (await yes.count()) { await yes.first().click(); await A.page.waitForTimeout(1500); }
      return (await policyOf(A.page, circle))?.features?.[feature] === want ? 'on' : 'off';
    }, { timeout: 90_000, intervals: [3_000], message: `A's vote carried ${feature}` }).toBe('on');
    log('STEP2 the circle voted the feature on', 'PASS', feature);

    // B joins only now
    await open(A.page);
    const invite = await getInvite(A.page, 'late-voted-invite');
    expect(invite, 'A has an invite').toBeTruthy();
    const joined = await joinFromInvite(B.page, invite, { handle: `bea${stamp}` });
    expect(joined.joined, joined.outcome).toBe(true);

    // B holds the voted change
    await expect.poll(async () => (await policyOf(B.page, circle))?.governance?.changePolicy ?? null,
      { timeout: 120_000, message: 'B holds who decides the settings' }).toBe('member-vote');
    const onB = await expect.poll(async () => (await policyOf(B.page, circle))?.features?.[feature] ?? null,
      { timeout: 120_000, message: `B holds the voted ${feature}` }).toBe(want).then(() => true, () => false);
    // …and B's Decisions screen does not say the admin skipped the vote
    await open(B.page);
    await openMore(B.page, 'governance');
    await B.page.waitForTimeout(2000);
    const refused = await B.page.locator('.circle-governance__disputed-line').allTextContents();
    log('STEP3 the late joiner', onB && refused.length === 0 ? 'PASS' : 'FAIL',
      `${feature} on B: ${onB}; refused lines: ${JSON.stringify(refused)}`);
    expect(refused, 'the Decisions screen says a voted change skipped the vote').toEqual([]);
    expect(onB, `the late joiner does not hold the voted ${feature}`).toBe(true);
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
