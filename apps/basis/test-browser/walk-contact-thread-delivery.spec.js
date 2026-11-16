/**
 * MY OWN DM BUBBLE SAYS HOW FAR THE MESSAGE GOT, AS A CIRCLE BUBBLE DOES.
 *
 * Two web apps over a local relay, contacts. A opens the thread with B from Contacten and sends a line. What must hold
 * (the two-phone walk, rows 9 and 11): A's own bubble carries a delivery chip at once (pending or further — never
 * nothing), and once B's app has stored the turn, B's receipt moves A's chip to "their app has it" (`stored`). The chip
 * is the circle bubble's chip: same classes, same words.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-contact-thread-delivery.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, log, gotoCircles } from './peerHarness.js';
import { nameMe, becomeContacts } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('a typed turn to a contact carries its delivery state, and the other side\'s receipt completes it', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    await nameMe(A.page, 'Anna'); await nameMe(B.page, 'Bea');
    const { bId } = await becomeContacts(A, B);

    // A opens the thread with B the way a person does: Contacten → the row
    await gotoCircles(A.page);
    await A.page.locator('[data-tab="contacten"]').first().click();
    await A.page.locator(`.cc-contacts__row[data-contact-id="${bId}"]`).first().click();
    await expect(A.page.locator('.cc-cthread')).toBeVisible({ timeout: 20_000 });

    const line = `hoi Bea ${Date.now()}`;
    await A.page.locator('.cc-cthread__input').fill(line);
    await A.page.locator('.cc-cthread__send').first().click();

    // the bubble is on screen with a chip: a state, not silence
    const mine = A.page.locator('.cc-cthread__msg--user .cc-cthread__bubble', { hasText: line });
    await expect(mine, 'my own bubble').toHaveCount(1, { timeout: 15_000 });
    const chip = mine.locator('.circle-view__bubble-delivery');
    await expect(chip, 'my own bubble carries a delivery chip').toHaveCount(1, { timeout: 15_000 });
    const first = await chip.getAttribute('data-delivery-state');
    expect(['pending', 'maybe-received', 'stored'], `an honest state, not "${first}"`).toContain(first);
    log('STEP1 my bubble says how far it got', 'PASS', first);

    // B's app stored it → B's receipt → A's chip reads "their app has it"
    await expect.poll(() => chip.getAttribute('data-delivery-state'), { timeout: 90_000, message: 'the receipt moved the chip' })
      .toBe('stored');
    log('STEP2 the receipt completed the chip', 'PASS');

    // and the composer carries no line of its own about it any more
    expect(await A.page.locator('.cc-cthread .cc-cthread__sending').count(), 'no "versturen…" line under the list').toBe(0);
    log('STEP3 one place says one thing about one message', 'PASS');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
