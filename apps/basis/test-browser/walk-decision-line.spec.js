/**
 * THE DECISION LINE IS A WAY IN, CLICKED THROUGH (L887, Fable 2026-11-14): three people on the real web shell over a
 * relay. A founds the circle and lets the MEMBERS decide removals (the Decisions screen's own setting). Bea and Cas
 * join. A removes Cas on Beheer: under that rule it opens a proposal, it does not remove. Bea hears of it as the line
 * "A decision opened" in the circle's conversation, taps its button, lands on the Decisions screen and votes yes there.
 * Her yes APPROVES it; the circle enacts by an admin's act (the default), so both devices show it approved and waiting
 * for an admin, and Cas is still in. Then A taps Enact (L893): it says what it did, and the removal lands on all three
 * devices, Cas's own included.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-decision-line.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, createCircle, openCircleMatching, toChat, getInvite, joinFromInvite, readRoster, openMore, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_PORT + PEER_TEST_RELAY');
test.setTimeout(600_000);

const CIRCLE = 'Besluit Samen';
const RE = /besluit samen/i;
const openWalk = async (page) => { await gotoCircles(page); await openCircleMatching(page, RE); };
const rosterNames = async (page) => ((await readRoster(page))?.names ?? []).map((n) => String(n ?? '').toLowerCase());

test('a member taps "A decision opened" and votes; approved, it waits for an admin, who enacts it, and the removal lands on all three', async ({ browser }) => {
  let A = null; let B = null; let C = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B'); C = await bootPeer(browser, 'C');
    await createCircle(A.page, CIRCLE);
    for (const [peer, handle] of [[B, 'bea'], [C, 'cas']]) {
      await openWalk(A.page);
      const invite = await getInvite(A.page);
      expect(invite, 'the founder has an invite').toBeTruthy();
      const joined = await joinFromInvite(peer.page, invite, { handle });
      expect(joined?.joined, `${handle} joined: ${joined?.outcome}`).toBe(true);
    }
    await expect.poll(async () => { await openWalk(A.page); return (await rosterNames(A.page)).join(','); }, { timeout: 120_000, intervals: [4_000] }).toMatch(/bea.*cas|cas.*bea/);
    log('STEP1 three in the circle', 'PASS', '');

    // A: the members decide removals (the Decisions screen's setting, an admin's)
    await openWalk(A.page);
    expect(await openMore(A.page, 'governance'), 'the Decisions entry is in the menu').toBe(true);
    const sel = A.page.locator('.circle-governance__setting[data-action="removeMember"] select');
    await expect(sel).toBeVisible({ timeout: 20_000 });
    await sel.selectOption('member-vote');
    await A.page.waitForTimeout(1500);
    await A.page.locator('.cc-governance__back').click();
    log('STEP2 the members decide removals', 'PASS', '');

    // A removes Cas on Beheer: a proposal opens, nobody is removed yet
    A.page.on('dialog', (d) => d.accept().catch(() => {}));
    await openWalk(A.page);
    expect(await openMore(A.page, 'admin')).toBe(true);
    const casRow = A.page.locator('li', { has: A.page.locator('.cc-admin__member-name', { hasText: /cas/i }) }).first();
    await casRow.locator('.cc-admin__member-remove').click();
    const confirm = A.page.getByRole('button', { name: /^(Confirm|Bevestigen)$/ });
    if (await confirm.count()) await confirm.first().click();
    await A.page.waitForTimeout(2000);
    await A.page.locator('.cc-admin__back').first().click().catch(() => {});   // out of Beheer (it hides the tab bar)
    await A.page.waitForTimeout(800);
    await openWalk(A.page);   // the roster is read on the circle's Members tab, not on Beheer
    const after = await readRoster(A.page);
    expect(after?.present, `the Members tab was read: ${JSON.stringify(after)}`).toBe(true);
    expect((after.names ?? []).some((n) => /cas/i.test(String(n))), `a proposal, not a removal: Cas is still in (${JSON.stringify(after.names)})`).toBe(true);
    log('STEP3 the removal is a proposal', 'PASS', '');

    // Bea: the line in the conversation, its button, the Decisions screen
    await openWalk(B.page); await toChat(B.page);
    const lineBtn = B.page.locator('.circle-view__embed-button', { hasText: /Decisions|Besluiten/ }).first();
    await expect.poll(async () => { await openWalk(B.page); await toChat(B.page); return lineBtn.count(); }, { timeout: 150_000, intervals: [5_000], message: 'the "a decision opened" line reaches Bea, with its way in' }).toBeGreaterThan(0);
    await lineBtn.click();
    await expect(B.page.locator('.cc-governance__back'), 'the Decisions screen opened from the line').toBeVisible({ timeout: 20_000 });
    log('STEP4 Bea reached Decisions from the line', 'PASS', '');

    // Bea votes yes there; the removal lands
    const yes = B.page.locator('.circle-governance__vote--yes').first();
    await expect(yes, 'the open removal offers Bea a vote').toBeVisible({ timeout: 30_000 });
    await yes.click();
    await expect(B.page.locator('.circle-governance__awaiting'), "Bea's yes approves it: the card says it waits for an admin").toBeVisible({ timeout: 20_000 });
    await expect(B.page.locator('.circle-governance__error'), 'the vote went through').toHaveCount(0);
    log('STEP5 Bea voted yes: approved, waiting for an admin', 'PASS', '');
    await B.page.locator('.cc-governance__back').first().click().catch(() => {});

    // THE TRUE STATE (Fable 2026-11-14): the circle enacts by an admin's act ('settle', the default since 2026-07-26: a
    // received message never removes someone by itself). The admin's device shows the same approved card, waiting;
    // Cas is still in on every device until an admin enacts it (the Enact act is its own row and extends this walk).
    await openWalk(A.page);
    expect(await openMore(A.page, 'governance')).toBe(true);
    await expect(A.page.locator('.circle-governance__awaiting'), "the admin's device shows it approved and waiting").toBeVisible({ timeout: 120_000 });
    await A.page.locator('.cc-governance__back').first().click().catch(() => {});
    await openWalk(B.page);
    expect((await rosterNames(B.page)).some((n) => /cas/.test(n)), 'not enacted yet: Cas is still in').toBe(true);
    log('STEP6 approved and waiting on both devices; Cas still in until an admin enacts', 'PASS', '');

    // THE ADMIN'S ACT (L893): A taps Enact on the approved card; it says what it did, and the removal lands on all three
    await openWalk(A.page);
    expect(await openMore(A.page, 'governance')).toBe(true);
    const enact = A.page.locator('.circle-governance__enact').first();
    await expect(enact, 'the admin sees Enact on the approved card').toBeVisible({ timeout: 30_000 });
    await enact.click();
    await expect(A.page.locator('.circle-governance__notice'), 'Enact says what it did').toBeVisible({ timeout: 30_000 });
    await expect(A.page.locator('.circle-governance__error')).toHaveCount(0);
    await A.page.locator('.cc-governance__back').first().click().catch(() => {});
    log('STEP7 the admin enacted it', 'PASS', '');
    await expect.poll(async () => { await openWalk(A.page); return (await rosterNames(A.page)).some((n) => /cas/.test(n)); }, { timeout: 120_000, intervals: [4_000], message: "the removal lands on the admin's device" }).toBe(false);
    await expect.poll(async () => { await openWalk(B.page); return (await rosterNames(B.page)).some((n) => /cas/.test(n)); }, { timeout: 150_000, intervals: [5_000], message: "the removal lands on Bea's device" }).toBe(false);
    // Cas's own device: the circle moves to the removed list (a read-only tile marked removed, until Cas closes it)
    await expect.poll(async () => { await gotoCircles(C.page); return C.page.locator('.circle-tile[data-removed="true"]', { hasText: RE }).count(); }, { timeout: 150_000, intervals: [5_000], message: "Cas's own device shows the circle as removed" }).toBe(1);
    log('STEP8 the removal landed on all three', 'PASS', '');
  } finally {
    await teardown([A, B, C].filter(Boolean));
  }
});
