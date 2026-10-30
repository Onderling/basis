/**
 * THE ROSTER TRAVELS BY ITS OWN CARRIERS — two acceptance stories, walked on real browser bytes over a local relay.
 *
 * A roster row is patched in place by proven-address announces and reaches other devices by its own carriers (the
 * membership lane, the announces, the roster seed). Until 2026-09-13 the items lane ALSO carried it, as a signed
 * snapshot, last version wins — and a sibling's snapshot of "the person's row" (which never names that sibling's own
 * address) landed on the box after the box had patched the new device's address in, and replaced it. Everything the
 * new device signed was then refused on the box as unbindable, one enrol in ten. `isLaneCarriedItem` (circles'
 * rosterTrail.js) is the fix: the items lane neither serves nor applies a roster row.
 *
 *   enrol-race    one person: A1 founds a circle with C in it; the box (A's always-on device, enrolled from A1) stays
 *                 up. Ten times over, a FRESH device is enrolled from A1, follows into the circle, and says a line in
 *                 its chat; the box must show that line within the catch-up window — a statement signed at the new
 *                 device's per-circle address binds on the box.
 *   pairing walk  A founds a circle with B, then C joins it. B and C never met: each line one says must reach the
 *                 other, and each holds the other's row with a proven per-circle address that is not the person's
 *                 global key. A fresh profile has the address fallback OFF, so a line that lands came by the
 *                 per-circle route.
 *
 * Both are the bar the roster-fold steps are held to. To see them RED, re-enable the items-lane carry of the trail row
 * with the test toggle below — a rewrite of the served `itemsRail.js` that lets `membership-redemption` rows through
 * the lane again (rules heads stay refused). The toggle lives here only, never in the product:
 *
 *   L467_TOGGLE_TRAIL_CARRY=1 PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-roster-carriers.spec.js
 *
 * Without the variable the stories run against the app as it is (green):
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-roster-carriers.spec.js
 */
import { test, expect } from '@playwright/test';
import {
  bootPeer, teardown, gotoCircles, pair, log, getInvite, joinFromInvite, openCircleMatching, toChat, sendChat,
  waitForBubble, readBubbles,
} from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const TOGGLE = process.env.L467_TOGGLE_TRAIL_CARRY === '1';
const ENROLS = Number(process.env.ENROL_RACE_ROUNDS || 10);
/** How long a line may take to reach a device that is already up (the catch-up window, with the relay's slack). */
const CATCH_UP_MS = 90_000;

/**
 * The test toggle: every context this browser opens serves an `itemsRail.js` whose lane refusal lets roster-trail rows
 * through. Counts the rewrites, so a run can prove the toggle took (a toggle that silently did not apply would make a
 * green run look like a pass against the reintroduced defect).
 */
function withTrailCarry(browser) {
  const stats = { served: 0, rewritten: 0 };
  const wrapped = Object.create(browser);
  wrapped.newContext = async (opts) => {
    const context = await browser.newContext(opts);
    await context.route(/\/itemsRail\.js(\?|$)/, async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      stats.served += 1;
      const imp = /import\s*\{\s*isLaneCarriedItem\s*\}\s*from\s*(["'][^"']+["']);?/;
      if (!imp.test(body)) { await route.fulfill({ response: res, body }); return; }
      stats.rewritten += 1;
      const next = body.replace(imp, (_, from) => `import { isLaneCarriedItem as __laneCarried } from ${from};`
        + ' const isLaneCarriedItem = (it) => __laneCarried(it)'
        + " && !(it?.type === 'membership-redemption' || it?.kind === 'membership-redemption');");
      await route.fulfill({ response: res, body: next });
    });
    return context;
  };
  return { browser: wrapped, stats };
}

const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const myCircles = async (page) => ((await call(page, 'pinboard', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
const members = async (page, circleId) => (await call(page, 'pinboard', 'listGroupMembers', { groupId: circleId }))?.members ?? [];
/** `who`'s row as `page` folds it: the primary and the proven set (for the failure message: which branch?). */
const rowOn = async (page, circleId, who) => {
  const m = (await members(page, circleId)).find((x) => x.webid === who);
  return m ? { present: true, primary: m.circleAddress ?? null, proven: m.circleAddresses ?? [] } : { present: false };
};
const dismissDialogs = (peer) => peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
/**
 * Into a circle's chat from wherever the app stands (it opens on Vandaag; the tiles live on the launcher). By the
 * circle's id, not its name: a freshly enrolled device can show the tile before the name has followed. Returns the
 * tile's label, so a run can say what the device showed.
 */
async function intoChat(page, circleId) {
  await gotoCircles(page);
  const tile = page.locator(`.circle-tile[data-circle-id="${circleId}"]`).first();
  await expect(tile, `a tile for ${circleId}`).toHaveCount(1, { timeout: 60_000 });
  const label = (await tile.innerText()).replace(/\s+/g, ' ').trim();
  await tile.click(); await page.waitForTimeout(2500);
  await toChat(page);
  return label;
}

/** Enrol a fresh device of `owner`'s person from `owner`, and wait until it is in `circle`. */
async function enrolFrom(browser, owner, label, circle) {
  const dev = await bootPeer(browser, label);
  dismissDialogs(dev);
  await gotoCircles(dev.page);
  const offer = await call(owner.page, 'household', 'buildEnrollOffer', {});
  expect(offer?.ok, `${label}: enrol offer ${JSON.stringify(offer)}`).toBe(true);
  const phrase = (await call(owner.page, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
  const enrolled = await dev.page.evaluate(async ([uri, words, lbl]) => {
    localStorage.setItem('onderling.enrollOffer', uri);
    return window.onderlingCall('household', 'enrollDevice', { mnemonic: words, label: lbl });
  }, [offer.uri, phrase, label]);
  expect(enrolled?.ok, `${label}: enrolled ${JSON.stringify(enrolled)}`).toBe(true);
  await dev.page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => dev.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await myCircles(dev.page)).includes(circle), { timeout: 90_000, message: `${label} is in the circle` }).toBe(true);
  return dev;
}

test.describe.configure({ mode: 'serial' });

test('enrol-race: ten fresh devices of one person, each one\'s first line binds on the box', async ({ browser: real }) => {
  test.setTimeout(ENROLS * 4 * 60_000 + 10 * 60_000);
  const { browser, stats } = TOGGLE ? withTrailCarry(real) : { browser: real, stats: null };
  const peers = [];
  try {
    const A1 = await bootPeer(browser, 'A1'); const C = await bootPeer(browser, 'C');
    peers.push(A1, C);
    const p = await pair(A1, C, { name: 'Inschrijfrace', re: /inschrijfrace/i, handle: 'cees' });
    expect(p.joined, `C joined: ${p.outcome}`).toBe(true);
    for (const peer of [A1, C]) dismissDialogs(peer);
    const circle = (await myCircles(A1.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    const aId = (await call(A1.page, 'pinboard', 'whoAmI'))?.webid;
    expect(circle, 'the circle').toBeTruthy();

    const box = await enrolFrom(browser, A1, 'BOX', circle);
    peers.push(box);
    expect((await call(box.page, 'pinboard', 'whoAmI'))?.webid, 'the box is the same person').toBe(aId);
    log('BOX tile', 'OBSERVED', await intoChat(box.page, circle));
    for (const peer of [A1, C]) await intoChat(peer.page, circle);   // the bystanders' view, for a failed round's probe
    log('SETUP A1 + box + C in one circle', 'PASS', String(circle).slice(0, 10));
    if (TOGGLE) expect(stats.rewritten, `the trail-carry toggle applied (served ${stats.served})`).toBeGreaterThan(0);

    const refused = [];
    for (let i = 1; i <= ENROLS; i++) {
      const dev = await enrolFrom(browser, A1, `NEW${i}`, circle);
      try {
        await intoChat(dev.page, circle);
        const line = `eerste woord ${i} ${Date.now().toString(36).slice(-5)}`;
        await sendChat(dev.page, line, 1000);
        const landed = await waitForBubble(box.page, line, { tries: Math.ceil(CATCH_UP_MS / 2500), every: 2500 });
        if (!landed) {
          // which branch: did the line leave the new device at all (A1 and C have it), and whose view lacks its address?
          const seen = {};
          for (const [label, peer] of [['A1', A1], ['C', C]]) seen[label] = (await readBubbles(peer.page)).some((t) => t.includes(line));
          const views = {};
          for (const [label, peer] of [['box', box], ['A1', A1], ['C', C], ['new', dev]]) views[label] = await rowOn(peer.page, circle, aId);
          refused.push(`round ${i}: line on ${JSON.stringify(seen)} · A's row ${JSON.stringify(views).slice(0, 900)}`);
        }
        log(`ROUND ${i} the new device's line on the box`, landed ? 'PASS' : 'FAIL', line);
      } finally {
        await teardown([dev]);
      }
    }
    expect(refused, `the box refused a new device's first line:\n${refused.join('\n')}`).toEqual([]);
  } finally {
    if (stats) log('TOGGLE trail carry', 'OBSERVED', `served ${stats.served} · rewritten ${stats.rewritten}`);
    await teardown(peers);
  }
});

test('pairing walk: two joiners who never met reach each other at per-circle addresses', async ({ browser: real }) => {
  test.setTimeout(15 * 60_000);
  const { browser, stats } = TOGGLE ? withTrailCarry(real) : { browser: real, stats: null };
  const peers = [];
  try {
    const A = await bootPeer(browser, 'A'); const B = await bootPeer(browser, 'B'); const C = await bootPeer(browser, 'C');
    peers.push(A, B, C);
    const p = await pair(A, B, { name: 'Twee nieuwkomers', re: /twee.?nieuwkomers/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    for (const peer of [A, B]) dismissDialogs(peer);   // C's join prompt is a dialog the join accepts: C's handler after
    await gotoCircles(A.page); await openCircleMatching(A.page, /twee.?nieuwkomers/i);
    const invite = await getInvite(A.page, 'pairing-walk-invite');
    expect(invite, 'A has an invite for the second joiner').toBeTruthy();
    const c = await joinFromInvite(C.page, invite, { handle: 'cees', tag: 'pairing-walk-C' });
    expect(c.joined, `C joined: ${c.outcome}`).toBe(true);
    dismissDialogs(C);
    const circle = (await myCircles(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    expect(circle, 'the circle').toBeTruthy();
    const bId = (await call(B.page, 'pinboard', 'whoAmI'))?.webid;
    const cId = (await call(C.page, 'pinboard', 'whoAmI'))?.webid;
    if (TOGGLE) expect(stats.rewritten, `the trail-carry toggle applied (served ${stats.served})`).toBeGreaterThan(0);
    log('SETUP A + B + C in one circle, B and C never met', 'PASS', String(circle).slice(0, 10));

    // each joiner holds the other's row with a proven per-circle address — never the person's global key
    for (const [label, page, other] of [['B', B.page, cId], ['C', C.page, bId]]) {
      await expect.poll(async () => {
        const r = await rowOn(page, circle, other);
        if (!r.present) return 'no row';
        if (!r.primary) return 'no proven address';
        if (r.primary === other) return 'the global key';
        return r.proven.includes(r.primary) ? 'per-circle' : 'primary not in the proven set';
      }, { timeout: CATCH_UP_MS, message: `${label} holds the other joiner at a per-circle address` }).toBe('per-circle');
      log(`STEP1 ${label} holds the other joiner at a per-circle address`, 'PASS', '');
    }

    // and a line each way lands (the address fallback is off on a fresh profile: no global-key route to take)
    for (const peer of [B, C]) await intoChat(peer.page, circle);
    for (const [from, to] of [[B, C], [C, B]]) {
      const line = `van ${from.label} aan ${to.label} ${Date.now().toString(36).slice(-5)}`;
      await sendChat(from.page, line, 1000);
      const landed = await waitForBubble(to.page, line, { tries: Math.ceil(CATCH_UP_MS / 2500), every: 2500 });
      expect(landed, `${from.label}'s line reached ${to.label}`).toBe(true);
      log(`STEP2 ${from.label} → ${to.label}`, 'PASS', line);
    }
  } finally {
    if (stats) log('TOGGLE trail carry', 'OBSERVED', `served ${stats.served} · rewritten ${stats.rewritten}`);
    await teardown(peers);
  }
});
