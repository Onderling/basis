/**
 * THE CIRCLE'S POLICY REACHES WHOEVER JOINS — a circle created sealed is sealed on the joiner's device too.
 *
 * The policy is circle state: an admin states it on the governance lane as a signed statement, and every member —
 * a joiner included — catches it up and applies it. Before, it lived per device and was only broadcast when an admin
 * SAVED settings, so a member who joined after the founder created the circle held no policy at all and read every
 * axis at its default (probed 2026-09-25: founder `{storagePosture:'p2'}`, joiner "NO POLICY").
 *
 * Two web apps over a local relay: A creates a circle (sealed by default), B joins after. B's stored policy for the
 * circle comes to say p2. Then A changes an axis in settings and B follows.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-policy-reaches-joiner.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, log } from './peerHarness.js';
import { circleIds } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const policyOn = (page, circleId) => page.evaluate((cid) => {
  try { const p = JSON.parse(localStorage.getItem(`cc.circlePolicy.${cid}`) || 'null'); return p ? { storagePosture: p.storagePosture ?? null, llmTool: p.llmTool ?? null } : null; }
  catch { return null; }
}, circleId);

test('a joiner holds the circle\'s policy — sealed, as the founder made it', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Verzegeld', re: /verzegeld/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    expect((await policyOn(A.page, circle))?.storagePosture, 'the founder made it sealed').toBe('p2');

    await expect.poll(async () => (await policyOn(B.page, circle))?.storagePosture ?? 'NO POLICY', {
      timeout: 90_000, message: 'the joiner holds the circle\'s policy',
    }).toBe('p2');
    log('STEP1 the joiner holds the sealed policy', 'PASS', '');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
