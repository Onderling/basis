/**
 * A LATE PULL REPAINTS AN OPEN CIRCLE. A fresh joiner holds only what was fanned to it after its join; what the circle
 * said before (here: one chat line) reaches it only by the join's pull. If the join wizard stops waiting for that pull,
 * the joiner may already be looking at the circle when the answer lands. This walk makes the answer late on purpose:
 * the admin goes offline the moment his roster shows the joiner (the redeem is done, the pull not yet answered), the
 * joiner opens the circle's conversation, then the admin comes back and the relay hands him the held pull.
 *
 * Three outcomes, each named:
 *   - the line is there before the admin returns: the pull was not late, the walk proves nothing (it says so);
 *   - the line appears on the OPEN screen, nobody navigating: the screen repaints on a late pull;
 *   - the line appears only after leaving and re-entering the circle: the data landed, the open screen did not repaint.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8796 npx playwright test --project=relay test-browser/walk-late-pull-repaint.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, gotoCircles, createCircle, openCircleMatching, toChat, getInvite, sendChat, readBubbles, joinFromInvite, reopenCircle, shot, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
test.setTimeout(420_000);

const stamp = Date.now().toString(36);
const CIRCLE = `Laatkring ${stamp}`;
const RE = new RegExp(`Laatkring ${stamp}`, 'i');
const EARLY_LINE = `vroeg gezegd ${stamp}`;
const HANDLE = `laat${stamp}`;


const hasLine = async (page) => (await readBubbles(page)).some((s) => s.includes(EARLY_LINE));

test('a pull that lands after the joiner opened the circle shows on the open screen', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [admin, joiner] = peers;
  try {
    await admin.page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
    await gotoCircles(admin.page);
    await createCircle(admin.page, CIRCLE);
    await openCircleMatching(admin.page, RE);
    await toChat(admin.page);
    await sendChat(admin.page, EARLY_LINE);
    const groupId = (await admin.page.evaluate(() => window.onderlingSurface?.([])))?.where?.circleId ?? null;
    expect(groupId, 'the admin is in his circle').toBeTruthy();
    const invite = await getInvite(admin.page, 'late-pull-invite');
    expect(invite, 'the admin has an invite').toBeTruthy();

    // the admin goes offline the moment the joiner's wizard says "connecting": the redeem is answered, the
    // post-join step (register, bind, pull) has not started. A roster poll on the admin's side was too slow: the pull
    // was answered before it fired (one of two runs).
    let offlineAt = null;
    let goingOffline = null;
    await joiner.page.exposeBinding('lateWalkConnecting', () => {
      if (!goingOffline) goingOffline = admin.page.context().setOffline(true).then(() => { offlineAt = Date.now(); });
      return goingOffline;
    });
    await joiner.page.evaluate(() => {
      const fire = () => {
        const el = document.querySelector('.cc-wizard-submitting');
        if (el && /verbonden|connecting/i.test(el.textContent || '')) { obs.disconnect(); window.lateWalkConnecting(); }
      };
      const obs = new MutationObserver(fire);
      obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const t0 = Date.now();
    const { joined, outcome } = await joinFromInvite(joiner.page, invite, { handle: HANDLE, tag: 'late-pull-join' });
    if (goingOffline) await goingOffline;
    log('join', joined ? 'OK' : 'FAIL', `${outcome}; wizard took ${Math.round((Date.now() - t0) / 1000)} s; admin offline ${offlineAt ? 'yes' : 'never'}`);
    expect(joined, outcome).toBe(true);
    expect(offlineAt, 'the admin went offline after the redeem').toBeTruthy();

    await gotoCircles(joiner.page);
    await openCircleMatching(joiner.page, RE);
    await toChat(joiner.page);
    await joiner.page.waitForTimeout(3000);
    const before = await hasLine(joiner.page);
    await shot(joiner.page, 'late-pull-01-open-before');
    log('before the admin returns', before ? 'INCONCLUSIVE' : 'OK', before ? 'the line is already there: the pull was not late' : 'the open circle lacks the early line');
    test.skip(before, 'the pull was not late; nothing to prove this run');

    // the admin comes back; the joiner touches nothing
    await admin.page.context().setOffline(false);
    let repainted = false;
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      if (await hasLine(joiner.page)) { repainted = true; break; }
      await joiner.page.waitForTimeout(2000);
    }
    await shot(joiner.page, 'late-pull-02-open-after');
    let afterReentry = repainted;
    if (!repainted) {
      await reopenCircle(joiner.page, RE);
      await joiner.page.waitForTimeout(3000);
      afterReentry = await hasLine(joiner.page);
      await shot(joiner.page, 'late-pull-03-reentered');
    }
    log('after the admin returns', repainted ? 'REPAINTED' : (afterReentry ? 'NO REPAINT' : 'NEVER LANDED'),
      repainted ? 'the open screen showed the line by itself'
        : (afterReentry ? 'the line was there only after re-entering the circle' : 'not even after re-entering: the late pull never landed'));
    expect(afterReentry, 'the late pull landed at all').toBe(true);
    expect(repainted, 'the open circle repainted when the late pull landed').toBe(true);
  } finally {
    await teardown(peers);
  }
});
