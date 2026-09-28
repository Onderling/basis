/**
 * A JOIN THAT CANNOT COMPLETE SAYS WHY — the admin is offline, try again later, the invitation stays valid.
 *
 * Joining needs a device of the circle's admin to answer. When none is online the join cannot complete, and what a
 * person is told decides whether they try again: "the invite is broken" and they give up, "the admin is offline" and
 * they come back. Two web apps over a local relay: A founds a circle and makes an invite, then goes offline (its app
 * closes). B opens the invite and walks the join → the wizard says the admin is offline and the invitation stays
 * valid, and B is not in the circle.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-join-admin-offline.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, createCircle, openCircleMatching, toChat, getInvite, joinFromInvite, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('the admin is offline: the joiner is told so, and that the invitation stays valid', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    await gotoCircles(A.page);
    await createCircle(A.page, 'Stille beheerder');
    await openCircleMatching(A.page, /stille.?beheerder/i); await toChat(A.page);
    const invite = await getInvite(A.page, 'offline-admin-invite');
    expect(invite, 'A made an invite').toBeTruthy();

    // A goes offline: its app closes. Nothing of A answers from here on.
    await teardown([A]); A = null;
    log('STEP1 the admin is offline', 'PASS', 'A\'s app closed');

    await gotoCircles(B.page);
    const { joined, outcome } = await joinFromInvite(B.page, invite, { handle: 'bea', tag: 'offline-admin-join' });
    log('STEP2 B tried to join', joined ? 'FAIL' : 'PASS', outcome);
    expect(joined, 'B cannot be admitted with nobody to admit them').toBe(false);
    expect(outcome, 'the wizard says the admin is offline, not that the invite is broken')
      .toMatch(/geen beheerder online|no admin is online/i);
    expect(outcome, '…and that the invitation stays valid').toMatch(/blijft geldig|stays valid/i);
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
