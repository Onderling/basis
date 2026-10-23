/**
 * THE FIRST FIVE MINUTES — what a stranger does on a fresh install, in order, as one walk against a local relay and a
 * second identity. It runs in the release tail, so this path never breaks silently between releases. Each step is
 * named in the log (STEP n … PASS/FAIL), so a red run says WHERE a newcomer would get stuck.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8788 npx playwright test --project=relay test-browser/walk-first-five-minutes.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, createCircle, openCircleMatching, toChat, getInvite, joinFromInvite, sendChat, waitForBubble, log, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('a stranger\'s first five minutes: onboarding, a handle, a note, their card, an invitation, a message, the day, feedback', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null; let F = null;
  try {
    // B is the stranger (a fresh install); A is someone who invites them; F stands for the alpha's FEEDBACK device —
    // the maker's own always-on account, whose card every build ships with (`seededContact.js`; the real device and
    // its enrol are the maker's own). A stub here: an ordinary web peer, so the walk proves the tester's side.
    [A, B, F] = [await bootPeer(browser, 'A', { lang: 'en' }), await bootPeer(browser, 'B', { lang: 'en' }), await bootPeer(browser, 'F', { lang: 'en' })];
    const page = B.page;
    // the install's seed: the feedback card goes in through the path the build-time seed takes (`addContactFromQr`)
    const feedbackCard = await F.page.evaluate(async () => (await window.onderlingCall('pinboard', 'getContactShareQr', {}))?.payload ?? null);
    expect(feedbackCard, 'the feedback device hands out a card').toBeTruthy();
    const seeded = await page.evaluate(async (payload) => window.onderlingCall('pinboard', 'addContactFromQr', { payload }), feedbackCard);
    const feedbackId = seeded?.contact?.webid ?? null;
    expect(feedbackId, `the seed adds the feedback contact: ${JSON.stringify(seeded).slice(0, 200)}`).toBeTruthy();

    // STEP 1 — the app opens on Vandaag with the first steps
    await expect(page.locator('.circle-vandaag__head'), 'the app opens on Vandaag').toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.circle-screen__onb-card[data-card="handle"]'), 'the first step asks for a name').toBeVisible({ timeout: 20_000 });
    log('STEP1 the onboarding strip', 'PASS', 'Vandaag with the first steps');

    // STEP 2 — a handle
    await page.locator('.circle-screen__onb-handle').fill('Sam');
    await page.locator('.circle-screen__onb-card[data-card="handle"] .circle-screen__onb-btn').first().click();
    await expect(page.locator('.circle-screen__onb-card[data-card="handle"]'), 'the name step is done and goes').toHaveCount(0, { timeout: 15_000 });
    log('STEP2 a handle', 'PASS', 'Sam');

    // STEP 3 — a note with the "+"
    await page.locator('.cc-fab').click();
    await page.locator('.circle-vandaag-plus__act[data-act="household.note"]').click();
    await page.locator('.circle-vandaag-plus__body').fill('melk halen');
    await page.locator('.circle-vandaag-plus__save').click();
    await expect(page.locator('.circle-screen__items-row').filter({ hasText: 'melk halen' }), 'the note is on Vandaag').toBeVisible({ timeout: 20_000 });
    log('STEP3 a note with the +', 'PASS', 'on Vandaag');

    // STEP 4 — share my contact: the card appears
    await page.locator('[data-tab="mij"]').first().click();
    await page.locator('.cc-profile__share-contact').first().click();
    await expect(page.locator('.cc-share'), 'the card screen').toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cc-share__error'), 'no error instead of a card').toHaveCount(0);
    await expect(page.locator('.cc-share__qr'), 'the card itself: its QR').toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cc-share__value').first(), '…and its code or link to copy').not.toHaveValue('');
    log('STEP4 my card', 'PASS', 'the card shows');

    // STEP 5 — an invitation from someone else, accepted
    await gotoCircles(A.page);
    await createCircle(A.page, 'Buren');
    await openCircleMatching(A.page, /buren/i); await toChat(A.page);
    const invite = await getInvite(A.page, 'first-five-invite');
    expect(invite, 'A made an invite').toBeTruthy();
    await gotoCircles(page);
    const { joined, outcome } = await joinFromInvite(page, invite, { handle: 'sam', tag: 'first-five-join' });
    log('STEP5 the invitation', joined ? 'PASS' : 'FAIL', outcome);
    expect(joined, `the stranger joins: ${outcome}`).toBe(true);

    // STEP 6 — the circle opens, and a message arrives
    await openCircleMatching(page, /buren/i); await toChat(page);
    await sendChat(A.page, 'Welkom, Sam!');
    const arrived = await waitForBubble(page, 'Welkom, Sam!');
    log('STEP6 a message arrives', arrived ? 'PASS' : 'FAIL', arrived ? 'in the circle' : 'never arrived');
    expect(arrived, 'A\'s message reaches the stranger').toBeTruthy();

    // STEP 7 — Vandaag shows the day
    await page.goto(page.url().split('#')[0]);
    await expect(page.locator('.circle-vandaag__day'), 'Vandaag is a day').not.toBeEmpty({ timeout: 20_000 });
    log('STEP7 Vandaag shows the day', 'PASS', '');

    // STEP 8 — feedback: the contact the app came with is in Contacten; a message to it arrives, and the answer comes back
    const note = `feedback from a stranger ${Date.now().toString(36)}`;
    const sent = await sendDirectMessage(page, note, { to: feedbackId });
    expect(sent.sent, `the stranger writes to the feedback contact: ${sent.why}`).toBe(true);
    const got = await waitForContactMessageDetailed(F.page, note);
    expect(got.painted, `the feedback device shows the stranger's message (found: ${got.found})`).toBe(true);
    const answer = `thanks, read it ${Date.now().toString(36)}`;
    const back = await sendDirectMessage(F.page, answer, { to: got.contactId });
    expect(back.sent, `the feedback device answers: ${back.why}`).toBe(true);
    const returned = await waitForContactMessageDetailed(page, answer);
    log('STEP8 feedback round trip', returned.painted ? 'PASS' : 'FAIL', returned.painted ? 'written, read, answered' : `answer found=${returned.found}`);
    expect(returned.painted, 'the answer reaches the stranger\'s screen').toBe(true);
  } finally {
    await teardown([A, B, F].filter(Boolean));
  }
});
