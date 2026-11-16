/**
 * THE NAME IN A CIRCLE IS FOR PEOPLE — a joiner called "Tester B" joins as "Tester B", and the members see that,
 * with no '@' before it.
 *
 * The name used to be an identifier (lowercase, 3 to 30, painted '@name'); "Tester B" was refused at the join and at
 * the circle store (walk, 2026-11-05). Two web apps over a local relay: A creates a circle, B (a fresh profile, so no
 * name yet: step 3's fold opens with the name field) joins as "Tester B". A's members list names B as written.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-join-name-as-written.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, readRoster, openCircleMatching, gotoCircles, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('a joiner called "Tester B" is "Tester B" to the circle, with no @', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Naamkring', re: /naamkring/i, handle: 'Tester B' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);

    await gotoCircles(A.page);
    await openCircleMatching(A.page, /naamkring/i);
    let roster = { names: [] };
    await expect.poll(async () => {
      roster = await readRoster(A.page);
      return roster.names.some((n) => n.includes('Tester B'));
    }, { timeout: 90_000, message: 'the founder sees the joiner as "Tester B"' }).toBe(true);
    expect(roster.names.filter((n) => /(^|\s)@\S/.test(n)), 'no member is painted with an @').toEqual([]);
    log('STEP1 the joiner is named as written', 'PASS', roster.names.join(' | '));
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
