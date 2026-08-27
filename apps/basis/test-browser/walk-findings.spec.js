/**
 * walk-findings.spec.js — re-check the 2026-08-27 walk findings against the REAL app.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * A day of walking with Frits produced a set of findings, and I diagnosed three of them against a
 * hand-assembled node composition instead of the product. Two of those diagnoses turned out to be my
 * harness: `walk-peer` boots without the device log, so membership statements take the legacy
 * non-fanning path — by design, for a composition without a log. A harness that rebuilds the app
 * cannot tell you the app is broken; it can only tell you about itself.
 *
 * Frits' correction (and the design this file follows): *"we do have a whole app for which only the
 * GUI must be replaced with some computer-readable GUI + you should be able to read what is happening
 * (logs). And that should be it."* So: two real browser contexts, the real app, the real transport,
 * both consoles captured — and instead of clicking CSS selectors, the walk READS what it is offered
 * (`window.onderlingSurface`) and invokes one of those ops (`window.onderlingDispatch`). Same waist a
 * tap compiles to, same capability gate a button obeys.
 *
 * ── Running it ───────────────────────────────────────────────────────────────────────────────────
 *   PEER_TEST_RELAY=ws://127.0.0.1:8790 PEER_TEST_PORT=5275 \
 *     npx playwright test walk-findings --project=relay --reporter=list
 *
 * Two headless contexts do not find each other over NKN, so the relay project is the one that pairs.
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, toChat, sendChat, readBubbles, log,
  gotoCircles, createCircle, openCircleMatching } from './peerHarness.js';

test.setTimeout(420_000);

/** Read the machine-readable surface — the affordances this peer is actually being offered. */
const surface = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
/** Read the app's own answer, unrendered — for questions about STATE rather than about what is shown. */
const call = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
/** Invoke one of them, through the same `{opId, args}` a tap compiles to. */
const dispatch = (page, opId, args = {}) =>
  page.evaluate(([o, a]) => window.onderlingDispatch?.(o, a), [opId, args]);
/** The circle the shell considers active — the seam echoes it back, so a walk never guesses an id. */
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;

test('the walk seam reports what the person is offered', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    const s = await surface(A.page);
    expect(s, 'window.onderlingSurface must exist — the seam is the whole point').toBeTruthy();
    log('seam', s ? 'PASS' : 'FAIL', `apps=${s?.apps?.join(',')} pages=${s?.pages?.length} actions=${s?.actions?.length}`);
    expect(Array.isArray(s.actions)).toBe(true);
    expect(Array.isArray(s.pages)).toBe(true);

    // The affordance list must be MANIFEST-shaped: every action names an op a walk can invoke.
    for (const a of s.actions) expect(typeof a.opId, `action without an opId: ${JSON.stringify(a)}`).toBe('string');

    // Print the affordance list. This is the thing a walk reads instead of guessing CSS classes —
    // and the thing that makes "there is no way to do X" a checkable claim.
    console.log('\nAFFORDANCES OFFERED:');
    for (const app of s.apps) {
      const mine = s.actions.filter((a) => a.appOrigin === app).map((a) => a.opId + (a.needsArgs ? '*' : ''));
      if (mine.length) console.log(`  ${app.padEnd(10)} ${mine.join(' ')}`);
    }
    console.log('\nPAGES:', s.pages.map((pg) => `${pg.appOrigin}/${pg.opId}`).join(' '));
  } finally { await teardown(peers); }
});

test('RC2 — does a send that reports success actually arrive?', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const paired = await pair(A, B, { name: 'Walk Kring', re: /walk.?kring/i });
    log('pair', paired.joined ? 'PASS' : 'BLOCKED', JSON.stringify(paired));
    test.skip(!paired.joined, 'pairing did not complete — nothing downstream is measurable');

    await toChat(A.page);
    await sendChat(A.page, 'RC2-BASELINE');
    await B.page.waitForTimeout(6000);
    // B is left on the LAUNCHER by `pair` — a peer who has not opened the circle has no bubbles to
    // read, and reading them there reports "nothing arrived" for a message that did.
    await openCircleMatching(B.page, /walk.?kring/i);
    await toChat(B.page);
    const got = await readBubbles(B.page);
    const arrived = got.some((t) => /RC2-BASELINE/.test(t));
    log('RC2 baseline', arrived ? 'PASS' : 'FAIL',
      arrived ? 'a live send arrives' : `B never saw it; B has: ${JSON.stringify(got.slice(0, 5))}`);
    expect(arrived, 'the baseline must cross, or the rest of this file measures nothing').toBe(true);

    // The finding: after the peer goes dark, what does the SENDER claim?
    await B.context.setOffline(true);
    await B.page.waitForTimeout(2000);
    await toChat(A.page);
    await sendChat(A.page, 'RC2-WHILE-DARK');
    await A.page.waitForTimeout(4000);
    await B.context.setOffline(false);
    await B.page.waitForTimeout(15000);

    await toChat(B.page);
    const after = await readBubbles(B.page);
    const held = after.some((t) => /RC2-WHILE-DARK/.test(t));
    log('RC2 held-then-flushed', held ? 'PASS' : 'FINDING',
      held ? 'the message was held and arrived on reconnect'
           : 'the message never arrived — and nothing on the sender said so (L50)');
  } finally { await teardown(peers); }
});

test('RC1a + DG1 — the roster after a role change, and what an evicted member is told', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const paired = await pair(A, B, { name: 'Rol Kring', re: /rol.?kring/i });
    log('pair', paired.joined ? 'PASS' : 'BLOCKED', JSON.stringify(paired));
    test.skip(!paired.joined, 'pairing did not complete');

    // RC1a — two roster reads on ONE device must not disagree about roles.
    const groupId = await activeCircle(A.page);
    log('active circle', groupId ? 'PASS' : 'BLOCKED', String(groupId));
    const roster  = await dispatch(A.page, 'listGroupRoster',  { groupId });
    const members = await call(A.page, 'stoop', 'listGroupMembers', { groupId });
    log('RC1a roster reads', 'OBSERVED',
      `listGroupRoster=${JSON.stringify(roster?.members ?? roster)} | listGroupMembers=${JSON.stringify((members?.members ?? []).map((m) => [String(m.webid).slice(0, 8), m.role]))}`);

    // DG1 — what does the member row OFFER? The walk found an inert card; the seam answers it as data.
    const rows = (members?.members ?? []).map((m) => ({ id: m.webid, type: 'member', label: m.handle ?? m.webid }));
    const s = await surface(A.page, rows);
    const offered = (s?.rows ?? []).map((r) => `${String(r.id).slice(0, 8)}:[${r.actions.map((a) => a.opId).join(',')}]`);
    log('DG1 member-row affordances', (s?.rows ?? []).some((r) => r.actions.length) ? 'PASS' : 'FINDING',
      offered.length ? offered.join(' ') : 'no member rows to probe');
  } finally { await teardown(peers); }
});

test('inside a circle, the seam reports the navigation a person actually has', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    await gotoCircles(A.page);
    await createCircle(A.page, 'Nav Kring');
    await openCircleMatching(A.page, /nav.?kring/i);
    await toChat(A.page);

    const s = await surface(A.page);
    log('in-circle surface', s?.where?.circleId ? 'PASS' : 'FAIL',
      `circle=${s?.where?.circleId} nav=[${(s?.nav ?? []).map((n) => n.id).join(',')}]`);

    // The ⋯ roster is the navigation. If `invite` is absent here, then a person in this circle has no
    // way to invite anyone — which is a finding about the app, not about a CSS selector.
    const ids = (s?.nav ?? []).map((n) => n.id);
    log('invite affordance', ids.includes('invite') ? 'PASS' : 'FINDING',
      ids.includes('invite') ? 'the circle offers "invite"' : `no invite in the roster; offered: ${ids.join(',')}`);
    // Cross-check the seam against the DOM it claims to describe. The old harness helper reported
    // "no invite" here, so one of the two is wrong and it matters which.
    const dom = await A.page.evaluate(() => ({
      moreBtn: document.querySelectorAll('.circle-view__more').length,
      itemsBefore: document.querySelectorAll('.circle-view__more-item').length,
    }));
    await A.page.locator('.circle-view__more').first().click().catch(() => {});
    await A.page.waitForTimeout(600);
    const after = await A.page.evaluate(() => ({
      items: [...document.querySelectorAll('.circle-view__more-item')].map((e) => e.dataset.action),
      menuOpen: !!document.querySelector('.circle-view__more-menu.is-open'),
    }));
    log('DOM vs seam', 'OBSERVED',
      `moreBtn=${dom.moreBtn} itemsBeforeClick=${dom.itemsBefore} afterClick=[${after.items.join(',')}] menuOpen=${after.menuOpen}`);
    expect(s?.where?.circleId, 'a circle must be active after opening one').toBeTruthy();
  } finally { await teardown(peers); }
});

test('FINDING — right after creating a circle, can the founder invite anyone?', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    await gotoCircles(A.page);
    await createCircle(A.page, 'Admin Kring');
    await openCircleMatching(A.page, /admin.?kring/i);
    await toChat(A.page);
    const groupId = await activeCircle(A.page);

    // Poll the op the invite modal calls. The question is not only "does it refuse" but "does it stop
    // refusing" — a race the founder waits out is a very different defect from a permanent one.
    const timeline = [];
    for (let i = 0; i < 12; i++) {
      const r = await call(A.page, 'stoop', 'getCurrentMembershipCode', { groupId });
      timeline.push(`${i * 5}s:${r?.error ? `ERR(${r.error})` : (r?.code ? 'CODE' : JSON.stringify(r)?.slice(0, 50))}`);
      if (!r?.error) break;
      await A.page.waitForTimeout(5000);
    }
    const ok = /CODE/.test(timeline[timeline.length - 1] ?? '');
    log('founder can invite', ok ? 'PASS' : 'FINDING', timeline.join(' '));

    // And what the roster says about the founder at the same moment.
    const members = await call(A.page, 'stoop', 'listGroupMembers', { groupId });
    log('founder role', 'OBSERVED',
      JSON.stringify((members?.members ?? []).map((m) => [String(m.webid).slice(0, 8), m.role, m.adminVia ?? '-'])));

    // MECHANISM: deriveRoster identifies founders from the circle's `group-rules` AUTHOR. If the
    // circle carries no rules — or none naming an author — there is nobody to force to `admin`, and a
    // circle ends up with a member who made it and cannot run it.
    const rules = await call(A.page, 'stoop', 'getGroupRules', { groupId });
    log('group rules', 'OBSERVED', JSON.stringify(rules)?.slice(0, 300));
    const mine = await call(A.page, 'stoop', 'listMyCircles', {});
    log('my circles', 'OBSERVED', JSON.stringify(mine)?.slice(0, 300));
  } finally { await teardown(peers); }
});
