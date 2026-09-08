/**
 * Two relays (2026-09-08): a person on their OWN relay joins a circle that rides ANOTHER one — and stays
 * reachable in it after a reload. This is how a self-hoster tests their network: invite from their box,
 * have someone on the default relay join.
 *
 * Arm with two local relays (the fixture starts both):
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8791 PEER_TEST_RELAY_2=ws://127.0.0.1:8792 \
 *     npx playwright test --project=relay test-browser/two-relays.spec.js
 *
 * What it proves, read from the app: B's primary stays its own relay, the circle's relay comes BESIDE it
 * (the join used to swap), a message crosses both ways, and after B reloads the extra relay is dialled
 * again from the recorded connection point — so the circle keeps working, not only during the join.
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, sendChat, waitForBubble, reopenCircle, toChat, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
const R2 = process.env.PEER_TEST_RELAY_2 || '';

test.skip(!R1 || !R2, 'needs PEER_TEST_RELAY and PEER_TEST_RELAY_2');

const relaysOf = (page) => page.evaluate(() => (window.onderlingRelays ? window.onderlingRelays() : []));

async function waitForRelays(page, pred, { tries = 20, every = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const list = await relaysOf(page);
    if (pred(list)) return list;
    await page.waitForTimeout(every);
  }
  return relaysOf(page);
}

test('a joiner on its own relay comes beside the circle relay, and is still there after a reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await bootPeer(browser, 'A', { transportMode: 'relay', relayUrl: R1 });
  const B = await bootPeer(browser, 'B', { transportMode: 'relay', relayUrl: R2 });
  try {
    expect((await waitForRelays(A.page, (l) => l.some((r) => r.connected))).map((r) => r.url)).toEqual([R1]);
    expect((await waitForRelays(B.page, (l) => l.some((r) => r.connected))).map((r) => r.url)).toEqual([R2]);
    log('STEP1 boot', 'PASS', `A on ${R1}, B on ${R2}`);

    const { joined, joinerHasTile, outcome } = await pair(A, B, { name: 'Twee relays', re: /twee.?relays/i, handle: 'bram' });
    expect(joined, `join outcome: ${outcome}`).toBe(true);
    expect(joinerHasTile).toBe(true);
    const bRelays = await waitForRelays(B.page, (l) => l.length === 2 && l.every((r) => r.connected));
    expect(bRelays.map((r) => [r.url, r.primary])).toEqual([[R2, true], [R1, false]]);
    log('STEP2 join across relays', 'PASS', `B is on ${bRelays.map((r) => r.url).join(' + ')}; primary unchanged`);

    // A → B, and B → A, over the circle's relay (R1) — B's alias for this circle lives there only.
    await reopenCircle(B.page, /twee.?relays/i); await toChat(B.page);
    await reopenCircle(A.page, /twee.?relays/i); await toChat(A.page);
    await sendChat(A.page, 'hallo over relay één');
    expect(await waitForBubble(B.page, 'hallo over relay één')).toBe(true);
    await sendChat(B.page, 'terug vanaf relay twee');
    expect(await waitForBubble(A.page, 'terug vanaf relay twee')).toBe(true);
    log('STEP3 messages cross', 'PASS', 'both directions');

    // B reloads: the extra relay must come back from the recorded connection point, not from the join.
    await B.page.reload();
    await B.page.waitForTimeout(4000);
    const after = await waitForRelays(B.page, (l) => l.length === 2 && l.every((r) => r.connected), { tries: 40 });
    expect(after.map((r) => [r.url, r.primary])).toEqual([[R2, true], [R1, false]]);
    await reopenCircle(B.page, /twee.?relays/i); await toChat(B.page);
    await sendChat(A.page, 'na de herstart');
    expect(await waitForBubble(B.page, 'na de herstart')).toBe(true);
    log('STEP4 after reload', 'PASS', 'extra relay redialled from the connection point; message arrived');
  } finally {
    await teardown([A, B]);
  }
});
