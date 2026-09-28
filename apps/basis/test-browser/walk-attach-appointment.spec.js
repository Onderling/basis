/**
 * THE + IN A CIRCLE: AN APPOINTMENT WORKS (AND A CARD IS A ROW ACTION) — what a tap on the attach menu dispatches lands in
 * the conversation, and the other member sees it.
 *
 * Frits chose "make them work" (2026-09-25). They had been fixed on 2026-09-01 — the device's own ops are not an app a
 * circle composes, so the availability rung skips them; a tap goes through the waist; a card reply is a message the
 * circle sees — and walked by hand then. This keeps it: two web apps over a local relay, one circle. A opens the +,
 * picks Appointment, fills its form; B sees "📅 <title>" in the conversation.
 *
 * CARD IS NOT IN THE + BY DESIGN: it takes an item id, so it became a row action on the item itself — "share this
 * here" on the task, the post, the event (`embed`'s `surfaces.ui` button). The + is for things that do not exist yet.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-attach-appointment.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, log, openCircleMatching, toChat, waitForBubble, gotoCircles } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('a circle\'s + offers Appointment; an appointment made from it reaches the other member', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Plus menu', re: /plus.?menu/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);

    await gotoCircles(A.page);
    await openCircleMatching(A.page, /plus.?menu/i); await toChat(A.page);
    const plus = A.page.locator('.circle-view__attach').first();
    await expect(plus, 'the circle composer has a +').toBeVisible({ timeout: 30_000 });
    await plus.click();
    const offered = await A.page.locator('.circle-view__attach-item').evaluateAll((els) => els.map((e) => e.dataset.opId));
    expect(offered, `the + offers: ${JSON.stringify(offered)}`).toContain('embed-time');
    expect(offered, 'Card is a row action on an item, not a + entry').not.toContain('embed');
    log('STEP1 the + offers Appointment', 'PASS', offered.join(' · '));

    await A.page.locator('.circle-view__attach-item[data-op-id="embed-time"]').click();
    const title = `Koffie ${Date.now().toString(36).slice(-4)}`;
    const titleInput = A.page.locator('input[name="title"]').first();
    await expect(titleInput, 'the appointment form opens').toBeVisible({ timeout: 20_000 });
    await titleInput.fill(title);
    const when = A.page.locator('input[name="when"]').first();
    const type = await when.getAttribute('type');
    await when.fill(type === 'date' ? '2026-10-02' : type === 'datetime-local' ? '2026-10-02T13:00' : '2026-10-02 13:00');
    await A.page.locator('.cc-form-submit').first().click();
    log('STEP2 A made an appointment from the +', 'PASS', title);

    await gotoCircles(B.page);
    await openCircleMatching(B.page, /plus.?menu/i); await toChat(B.page);
    const seen = await waitForBubble(B.page, title, { tries: 20, every: 3000 });
    expect(seen, `B sees "📅 ${title}"`).toBeTruthy();
    log('STEP3 B sees it', 'PASS', '');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
