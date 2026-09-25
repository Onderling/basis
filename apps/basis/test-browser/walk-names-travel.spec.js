/**
 * NAMES TRAVEL — a contact who renames themselves is renamed on your Contacten row, with no message in between, and
 * the row says what they were called until you open the thread.
 *
 * Two web apps over a local relay, contacts (a pair circle between them). B renames under Mij and sends nothing.
 * A's Contacten row reads the new name (it arrived on the pair roster as B's own `member-props`), with a "was:" line
 * naming the old one; A opens the thread and comes back → the line is gone. Walked by hand on 2026-09-22, never as a
 * spec until now.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-names-travel.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log } from './peerHarness.js';
import { nameMe, becomeContacts, contactRow } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('B renames under Mij, sends nothing: A\'s Contacten row renames, and says "was" until A opens the thread', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    for (const peer of [A, B]) peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await nameMe(A.page, 'Anna'); await nameMe(B.page, 'Bea');
    const { bId } = await becomeContacts(A, B);
    await expect.poll(async () => (await contactRow(A.page, bId))?.name ?? null, { timeout: 60_000, message: 'A sees B by the name B gave' }).toBe('Bea');
    log('SETUP contacts, named', 'PASS', '');

    await nameMe(B.page, 'Bea Jansen');   // no message — the rename is the only thing B does
    await expect.poll(async () => (await contactRow(A.page, bId))?.name ?? null, { timeout: 60_000, message: 'the rename reached A\'s row' }).toBe('Bea Jansen');
    const row = await contactRow(A.page, bId);
    expect(row.was, 'the row says what B was called').toMatch(/Bea(?! Jansen)/);
    log('STEP1 renamed, with the was-line', 'PASS', row.was);

    await A.page.locator(`.cc-contacts__row[data-contact-id="${bId}"]`).first().click();
    await A.page.waitForTimeout(2000);
    await gotoCircles(A.page);
    await expect.poll(async () => (await contactRow(A.page, bId))?.was ?? null, { timeout: 20_000, message: 'opened → the was-line is gone' }).toBeNull();
    log('STEP2 opened → acknowledged', 'PASS', '');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
