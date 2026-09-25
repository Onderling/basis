/**
 * ANY ADMIN RE-ADMITS — someone who left can be let back in by an admin who did not found the circle.
 *
 * Until L127 the roster read admitted a join signed by someone other than the joiner on a FOUNDER's authority only:
 * an admin the founder promoted could invite newcomers through the trail seed, and could never re-admit someone who
 * left — every device dropped that join. Now a join is admitted when its author is an admin at that causal point.
 *
 * Three web apps over a local relay: A founds a circle, B and C join, A promotes B. C leaves. B (not the founder)
 * invites C again from B's own device; C joins → C is back on A's, B's and C's roster.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-any-admin-readmits.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, pair, log, getInvite, joinFromInvite, openCircleMatching, toChat } from './peerHarness.js';
import { call, circleIds, whoAmI } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const onRoster = async (page, circleId, webid) => ((await call(page, 'stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? [])
  .some((m) => m.webid === webid);
const roleOf = async (page, circleId, webid) => ((await call(page, 'stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? [])
  .find((m) => m.webid === webid)?.role ?? null;

test('a promoted admin re-admits someone who left: they are back on every roster', async ({ browser }) => {
  test.setTimeout(600_000);
  let A = null; let B = null; let C = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B'); C = await bootPeer(browser, 'C');
    const p = await pair(A, B, { name: 'Terug welkom', re: /terug.?welkom/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    await gotoCircles(A.page);
    await openCircleMatching(A.page, /terug.?welkom/i); await toChat(A.page);
    const inviteA = await getInvite(A.page, 'readmit-A-invite');
    expect(inviteA, 'A\'s invite').toBeTruthy();
    const cJoin = await joinFromInvite(C.page, inviteA, { handle: 'cees', tag: 'readmit-C-first' });
    expect(cJoin.joined, `C joined: ${cJoin.outcome}`).toBe(true);
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    const [bId, cId] = [await whoAmI(B.page), await whoAmI(C.page)];
    for (const [label, peer] of [['A', A], ['B', B], ['C', C]]) {
      await expect.poll(() => onRoster(peer.page, circle, cId), { timeout: 60_000, message: `${label} has C` }).toBe(true);
    }
    log('SETUP A founds, B + C in', 'PASS', String(circle).slice(0, 10));

    const promoted = await call(A.page, 'stoop', 'setMemberRole', { groupId: circle, memberWebid: bId, role: 'admin' });
    expect(promoted?.error ?? null, JSON.stringify(promoted)).toBeNull();
    await expect.poll(() => roleOf(B.page, circle, bId), { timeout: 60_000, message: 'B knows B is an admin' }).toBe('admin');
    log('STEP1 A promotes B', 'PASS', '');

    const left = await call(C.page, 'stoop', 'leaveGroup', { groupId: circle, confirm: true });
    expect(left?.error ?? null, JSON.stringify(left)).toBeNull();
    for (const [label, peer] of [['A', A], ['B', B]]) {
      await expect.poll(() => onRoster(peer.page, circle, cId), { timeout: 60_000, message: `${label} dropped C` }).toBe(false);
    }
    log('STEP2 C left', 'PASS', '');

    // B — not the founder — invites C again, from B's own device
    await gotoCircles(B.page);
    await openCircleMatching(B.page, /terug.?welkom/i); await toChat(B.page);
    const inviteB = await getInvite(B.page, 'readmit-B-invite');
    expect(inviteB, 'the promoted admin can invite').toBeTruthy();
    await gotoCircles(C.page);
    const back = await joinFromInvite(C.page, inviteB, { handle: 'cees', tag: 'readmit-C-back' });
    expect(back.joined, `C re-joined: ${back.outcome}`).toBe(true);
    for (const [label, peer] of [['A', A], ['B', B], ['C', C]]) {
      await expect.poll(() => onRoster(peer.page, circle, cId), { timeout: 90_000, message: `${label}: C is back` }).toBe(true);
      log(`STEP3 ${label} has C back`, 'PASS', '');
    }
  } finally {
    await teardown([A, B, C].filter(Boolean));
  }
});
