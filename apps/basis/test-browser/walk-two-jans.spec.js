/**
 * TWO PEOPLE CALLED JAN — both get into the circle, and the founder tells them apart by a small number.
 *
 * The name in a circle was unique; since 2026-11-06 it is for people and two members may share one (uniqueness stays on
 * the key). Three web apps over a local relay: A creates a circle, B and C both join as "Jan". Neither is refused, and
 * A's members list reads "Jan" and "Jan · 2".
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-two-jans.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, getInvite, joinFromInvite, readRoster, openCircleMatching, gotoCircles, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('two joiners called Jan both get in; the founder reads "Jan" and "Jan · 2"', async ({ browser }) => {
  test.setTimeout(540_000);
  let A = null; let B = null; let C = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B'); C = await bootPeer(browser, 'C');
    const p = await pair(A, B, { name: 'Jankring', re: /jankring/i, handle: 'Jan' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);

    await gotoCircles(A.page);
    await openCircleMatching(A.page, /jankring/i);
    const invite = await getInvite(A.page, 'jans-invite-c');
    expect(invite, 'a second invite for C').toBeTruthy();
    const c = await joinFromInvite(C.page, invite, { handle: 'Jan', tag: 'jans-c' });
    expect(c.joined, `C joined as Jan too, not refused: ${c.outcome}`).toBe(true);

    await gotoCircles(A.page);
    await openCircleMatching(A.page, /jankring/i);
    let roster = { names: [] };
    await expect.poll(async () => {
      roster = await readRoster(A.page);
      return roster.names.filter((n) => /\bJan\b/.test(n)).length;
    }, { timeout: 120_000, message: 'the founder sees both Jans' }).toBe(2);
    expect(roster.names.some((n) => n.includes('Jan · 2')), `one of them carries the number: ${roster.names.join(' | ')}`).toBe(true);
    log('STEP1 two Jans, told apart by a number', 'PASS', roster.names.join(' | '));
  } finally {
    await teardown([A, B, C].filter(Boolean));
  }
});
