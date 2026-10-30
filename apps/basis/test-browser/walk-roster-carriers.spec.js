/**
 * THE ROSTER TRAVELS BY ITS OWN CARRIERS — two acceptance stories, walked on real browser bytes over a local relay.
 *
 * A member's proven per-circle addresses reach the circle's other devices by the roster's own carriers: the join
 * statements on the membership lane, the proven-address announces, the admin's hand-over after a join, the roster seed
 * between a person's own devices. These stories hold those carriers to what a person sees.
 *
 *   a third own device   one person: A1 founds a circle with C in it; the box (A's always-on device, enrolled from A1)
 *                        stays up. Ten times over, a FRESH device is enrolled from A1, follows into the circle and says a
 *                        line in its chat; the box must show that line within the catch-up window — the new device's
 *                        address has reached its already-enrolled sibling, so what it signs binds there. The box's tile
 *                        must also carry the circle's name. EXPECTED TO FAIL today: A1, C and the new device fold the
 *                        new address, the box does not (the announce reaches the others, never the sibling), and the
 *                        box's tile shows the circle's id. The membership-lane address statement is the cure; the change
 *                        that lands it turns this into a plain test, and is not done while it is red.
 *   two joiners          A founds a circle with B, then C joins it. B and C never met: each holds the other's row at a
 *                        proven per-circle address that is not the person's global key, and a line each way lands. A
 *                        fresh profile has the address fallback OFF, so a line that lands came by the per-circle route.
 *                        Its red leg: skip the admin's hand-over after a join (`propagateCircleAddressesAfterJoin`) and
 *                        B and C cannot reach each other — the hole that hand-over closed.
 *
 * The red leg's toggle is a rewrite of the served module, applied by this spec only, never by the product:
 *
 *   TOGGLE_SKIP_JOIN_HANDOVER=1 PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-roster-carriers.spec.js -g "two joiners"
 *
 * Without it the stories run against the app as it is:
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

const SKIP_JOIN_HANDOVER = process.env.TOGGLE_SKIP_JOIN_HANDOVER === '1';
const ENROLS = Number(process.env.ENROL_RACE_ROUNDS || 10);
/** How long a line may take to reach a device that is already up (the catch-up window, with the relay's slack). */
const CATCH_UP_MS = 90_000;

/**
 * Every context `browser` opens serves the modules matching `url` through `rewrite`. Counts what it served and what it
 * changed, so a run can prove the toggle took: a toggle that silently did not apply makes a green run look like a pass
 * against the defect it was meant to bring back.
 */
function withRewrite(browser, url, rewrite) {
  const stats = { served: 0, rewritten: 0 };
  const wrapped = Object.create(browser);
  wrapped.newContext = async (opts) => {
    const context = await browser.newContext(opts);
    await context.route(url, async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      stats.served += 1;
      const next = rewrite(body);
      if (next !== body) stats.rewritten += 1;
      await route.fulfill({ response: res, body: next });
    });
    return context;
  };
  return { browser: wrapped, stats };
}

/** The admin's hand-over after a join answers as if it had nobody to tell. */
const skipJoinHandover = (body) => body.replace(
  /export async function propagateCircleAddressesAfterJoin\(\{/,
  'export async function propagateCircleAddressesAfterJoin() { return { toCircle: 0, toNewMember: 0, announced: 0 }; }\n'
    + 'async function propagateSkippedByTest({',
);

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
/** The circle's tile on the launcher (the app opens on Vandaag; the tiles live there). By id: the name may not have followed. */
async function tileOf(page, circleId) {
  await gotoCircles(page);
  const tile = page.locator(`.circle-tile[data-circle-id="${circleId}"]`).first();
  await expect(tile, `a tile for ${circleId}`).toHaveCount(1, { timeout: 60_000 });
  return tile;
}
const tileLabel = async (page, circleId) => ((await (await tileOf(page, circleId)).innerText()) || '').replace(/\s+/g, ' ').trim();
async function intoChat(page, circleId) {
  await (await tileOf(page, circleId)).click(); await page.waitForTimeout(2500);
  await toChat(page);
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

test('a third own device\'s address reaches an already-enrolled sibling, ten enrolments over', async ({ browser }) => {
  test.setTimeout(ENROLS * 4 * 60_000 + 10 * 60_000);
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
    for (const peer of [box, A1, C]) await intoChat(peer.page, circle);   // A1 and C: the bystanders, for a failed round's probe
    log('SETUP A1 + box + C in one circle', 'PASS', String(circle).slice(0, 10));
    // Expected to fail from HERE, not before: a setup that breaks is the harness's failure and must show as one.
    test.fail(true, 'the new address reaches A1 and C but never the box, and the box\'s tile shows the circle id — the membership-lane address statement cures both');

    // the circle's name followed to the sibling, as it did to every other device
    let label = '';
    for (const until = Date.now() + CATCH_UP_MS; Date.now() < until && !/inschrijfrace/i.test(label);) {
      label = await tileLabel(box.page, circle);
      if (!/inschrijfrace/i.test(label)) await box.page.waitForTimeout(2500);
    }
    log('BOX tile', /inschrijfrace/i.test(label) ? 'PASS' : 'FAIL', label);
    expect.soft(label, 'the box\'s tile carries the circle\'s name').toMatch(/inschrijfrace/i);
    await intoChat(box.page, circle);

    for (let i = 1; i <= ENROLS; i++) {
      const dev = await enrolFrom(browser, A1, `NEW${i}`, circle);
      try {
        await intoChat(dev.page, circle);
        const line = `eerste woord ${i} ${Date.now().toString(36).slice(-5)}`;
        await sendChat(dev.page, line, 1000);
        const landed = await waitForBubble(box.page, line, { tries: Math.ceil(CATCH_UP_MS / 2500), every: 2500 });
        log(`ROUND ${i} the new device's line on the box`, landed ? 'PASS' : 'FAIL', line);
        if (!landed) {
          // which branch: did the line leave the new device at all (A1 and C have it), and whose view lacks its address?
          const seen = {};
          for (const [label, peer] of [['A1', A1], ['C', C]]) seen[label] = (await readBubbles(peer.page)).some((t) => t.includes(line));
          const views = {};
          for (const [label, peer] of [['box', box], ['A1', A1], ['C', C], ['new', dev]]) views[label] = await rowOn(peer.page, circle, aId);
          // one refused round is the defect; the rest of the rounds would only repeat it
          expect(landed, `round ${i}: the box refused the new device's first line · line on ${JSON.stringify(seen)} · A's row ${JSON.stringify(views).slice(0, 900)}`).toBe(true);
        }
      } finally {
        await teardown([dev]);
      }
    }
  } finally {
    await teardown(peers);
  }
});

test('two joiners who never met reach each other at per-circle addresses', async ({ browser: real }) => {
  test.setTimeout(15 * 60_000);
  const { browser, stats } = SKIP_JOIN_HANDOVER
    ? withRewrite(real, /\/circleAddressAnnounce\.js(\?|$)/, skipJoinHandover)
    : { browser: real, stats: null };
  const peers = [];
  try {
    const A = await bootPeer(browser, 'A'); const B = await bootPeer(browser, 'B'); const C = await bootPeer(browser, 'C');
    peers.push(A, B, C);
    const p = await pair(A, B, { name: 'Twee nieuwkomers', re: /twee.?nieuwkomers/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    for (const peer of [A, B]) dismissDialogs(peer);   // C's join prompt is a dialog the join accepts: C's handler after
    await gotoCircles(A.page); await openCircleMatching(A.page, /twee.?nieuwkomers/i);
    const invite = await getInvite(A.page, 'two-joiners-invite');
    expect(invite, 'A has an invite for the second joiner').toBeTruthy();
    const c = await joinFromInvite(C.page, invite, { handle: 'cees', tag: 'two-joiners-C' });
    expect(c.joined, `C joined: ${c.outcome}`).toBe(true);
    dismissDialogs(C);
    const circle = (await myCircles(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    expect(circle, 'the circle').toBeTruthy();
    const bId = (await call(B.page, 'pinboard', 'whoAmI'))?.webid;
    const cId = (await call(C.page, 'pinboard', 'whoAmI'))?.webid;
    if (stats) expect(stats.rewritten, `the skip-the-hand-over toggle applied (served ${stats.served})`).toBeGreaterThan(0);
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
    if (stats) log('TOGGLE skip the join hand-over', 'OBSERVED', `served ${stats.served} · rewritten ${stats.rewritten}`);
    await teardown(peers);
  }
});
