/**
 * walk-transports.spec.js — the same journeys on NKN, on both, and across a failover.
 *
 * Frits: *"maybe you can try a few of the already on relay tested journeys and check if they also work
 * on NKN. First without having a relay connected, then with a relay connected. I'm curious if the
 * fallback/switching between connections is working smoothly or not."*
 *
 * Three configurations, the same two journeys in each, so a difference is attributable:
 *   1 · NKN ONLY      no relay configured anywhere — the "no infrastructure we run" case
 *   2 · BOTH          relay + NKN available; which one carries, and does the choice look deliberate?
 *   3 · FAILOVER      start on both, then take the relay away mid-conversation
 *
 * Run: `--project=nkn` for 1, `--project=relay` (with PEER_TEST_RELAY armed) for 2 and 3.
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { bootPeers, teardown, pair, toChat, sendChat, readBubbles, log,
  gotoCircles, openCircleMatching } from './peerHarness.js';

test.setTimeout(420_000);

const surface = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;

/** Everything the transports say about themselves, from before boot. */
function listen(peer, into) {
  peer.page.on('console', (m) => {
    const t = m.text();
    if (/transport|nkn|relay|routing|failing over|rendezvous|hold/i.test(t)) into.push(t.slice(0, 170));
  });
}

/** The core journey, run identically in every configuration so a difference means the transport. */
async function coreJourney(A, B, label, lines) {
  const p = await pair(A, B, { name: `${label} Kring`, re: new RegExp(`${label}.?kring`, 'i'), handle: 'bram' });
  log(`${label} · does pairing complete?`, p.joined ? 'PASS' : 'FINDING', JSON.stringify(p.outcome));
  if (!p.joined) return null;
  const gid = await activeCircle(A.page);
  const byId = new RegExp(`${label}.?kring|${gid}`, 'i');

  await openCircleMatching(B.page, byId).catch(() => {});
  await toChat(B.page); await toChat(A.page);
  await sendChat(A.page, `${label.toUpperCase()}-EEN`);
  await B.page.waitForTimeout(9000);
  const got = await readBubbles(B.page);
  log(`${label} · does a message cross?`, got.some((t) => t.includes(`${label.toUpperCase()}-EEN`)) ? 'PASS' : 'FINDING',
    `${got.length} bubble(s)`);

  // The island: remove B and check the two halves that matter.
  const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
  const bId = (await call(B.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
  const rem = await call(A.page, 'stoop', 'removeMember', { groupId: gid, memberWebid: bId, reason: label });
  log(`${label} · removal`, rem?.revoked ? 'PASS' : 'FINDING', JSON.stringify(rem)?.slice(0, 110));
  await B.page.waitForTimeout(12000);
  await openCircleMatching(B.page, byId).catch(() => {});
  await toChat(B.page);
  const after = await readBubbles(B.page);
  log(`${label} · is the removed member told?`, after.some((t) => /geen lid meer/i.test(t)) ? 'PASS' : 'FINDING',
    JSON.stringify(after.filter((t) => /geen lid/i.test(t)).slice(0, 1)));

  const routed = [...new Set(lines.filter((t) => /routing across/i.test(t)))];
  log(`${label} · what the transports say`, 'OBSERVED', JSON.stringify(routed.slice(0, 2)));
  return { gid, me, bId };
}

test('transports 1 — NKN only, no relay anywhere', async ({ browser }) => {
  const peers = await bootPeers(browser, 2, { transportMode: 'nkn' });
  const [A, B] = peers;
  const lines = [];
  listen(A, lines); listen(B, lines);
  try {
    await Promise.all(peers.map((p) => p.page.reload()));
    await A.page.waitForTimeout(6000);
    const cfg = await A.page.evaluate(() => {
      const ls = {}; try { for (const k of Object.keys(localStorage)) if (/relay|transport/i.test(k)) ls[k] = localStorage.getItem(k); } catch { /* */ }
      return ls;
    });
    log('nkn-only · configuration', 'OBSERVED', JSON.stringify(cfg));
    await gotoCircles(A.page);
    await coreJourney(A, B, 'Nkn', lines);
  } finally { await teardown(peers); }
});

test('transports 2 — both available: which one carries?', async ({ browser }) => {
  const peers = await bootPeers(browser, 2, { transportMode: 'both' });
  const [A, B] = peers;
  const lines = [];
  listen(A, lines); listen(B, lines);
  try {
    await Promise.all(peers.map((p) => p.page.reload()));
    await A.page.waitForTimeout(6000);
    await gotoCircles(A.page);
    await coreJourney(A, B, 'Beide', lines);
    const failovers = [...new Set(lines.filter((t) => /failing over|failed for/i.test(t)))];
    log('both · did anything have to fail over?', failovers.length ? 'OBSERVED' : 'PASS',
      failovers.length ? JSON.stringify(failovers.slice(0, 3)) : 'no failover was needed');
  } finally { await teardown(peers); }
});

test('transports 3 — the relay goes away mid-conversation, NKN stays', async ({ browser }) => {
  const peers = await bootPeers(browser, 2, { transportMode: 'both' });
  const [A, B] = peers;
  const lines = [];
  listen(A, lines); listen(B, lines);
  try {
    await Promise.all(peers.map((p) => p.page.reload()));
    await A.page.waitForTimeout(6000);
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Wissel Kring', re: /wissel.?kring/i, handle: 'bram' });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);
    const byId = new RegExp(`wissel.?kring|${gid}`, 'i');
    await openCircleMatching(B.page, byId).catch(() => {});
    await toChat(B.page); await toChat(A.page);

    await sendChat(A.page, 'VOOR-DE-WISSEL');
    await B.page.waitForTimeout(8000);
    const before = await readBubbles(B.page);
    expect(before.some((t) => /VOOR-DE-WISSEL/.test(t)), 'the baseline must cross').toBe(true);
    log('failover · baseline on both transports', 'PASS', 'a message crosses');

    // Take the RELAY away and leave NKN alone — the case the ladder exists for. Closing the socket is
    // closer to a relay outage than going offline, which would take NKN with it.
    // Match the ACTUAL relay, not a guessed port range. My first pattern was /.*:88\d\d.*/ while the
    // fixture was on :8921, so it blocked nothing and the test reported a failover that never happened.
    const relayUrl = process.env.PEER_TEST_RELAY || '';
    const relayPort = (relayUrl.match(/:(\d+)/) ?? [])[1] ?? null;
    let blocked = false;
    if (relayPort) {
      for (const peer of peers) {
        try {
          await peer.page.routeWebSocket(new RegExp(`:${relayPort}(/|$)`), (ws) => { ws.close(); });
          blocked = true;
        } catch { /* older playwright — reported below */ }
      }
    }
    log('failover · the relay being cut', 'OBSERVED', `relay=${relayUrl} port=${relayPort}`);
    log('failover · could the relay be cut without cutting NKN?', blocked ? 'PASS' : 'BLOCKED',
      blocked ? 'relay sockets are being closed' : 'routeWebSocket unavailable — cannot isolate the relay');
    test.skip(!blocked, 'cannot isolate the relay');

    // A reload is the only way to make an EXISTING relay socket go away — `routeWebSocket` intercepts
    // new connections, not ones already open. So this doubles as a question worth asking on its own:
    // with the relay unreachable, does the app become usable at all, and how long does it take?
    await Promise.all(peers.map((p2) => p2.page.reload()));
    let usableAfter = null;
    for (let i = 1; i <= 12; i += 1) {
      await A.page.waitForTimeout(5000);
      // Via the LAUNCHER: after a reload the app lands on the Schermen tab, and `openCircleMatching`
      // alone cannot get to a circle from there. Reading "no composer" as "the app is stuck" would have
      // been a serious false finding about booting without a relay — the app was fine and on screen.
      await gotoCircles(A.page).catch(() => {});
      await openCircleMatching(A.page, byId).catch(() => {});
      if (await A.page.locator('.circle-view__composer-input').count()) { usableAfter = i * 5; break; }
    }
    log('failover · with the relay unreachable, is the app usable?', usableAfter ? 'PASS' : 'FINDING',
      usableAfter ? `the composer appeared after ~${usableAfter}s` : 'no composer within 60s of boot');
    if (!usableAfter) {
      const seen = await A.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 240));
      log('failover · what the screen shows instead', 'OBSERVED', seen);
      return;
    }
    await gotoCircles(B.page).catch(() => {});
    await openCircleMatching(B.page, byId).catch(() => {});
    await toChat(A.page); await toChat(B.page);

    await sendChat(A.page, 'NA-DE-WISSEL');
    // NKN takes 30–60s to bootstrap from cold (measured in test 1), and both peers just reloaded. A
    // 20-second verdict would be about my patience, not the ladder — so poll for a minute and a half
    // and report WHEN it lands as well as whether.
    let arrivedAfter = null;
    for (let i = 1; i <= 18; i += 1) {
      await B.page.waitForTimeout(5000);
      await toChat(B.page).catch(() => {});
      const now = await readBubbles(B.page);
      if (now.some((t) => /NA-DE-WISSEL/.test(t))) { arrivedAfter = i * 5; break; }
    }
    const after = await readBubbles(B.page);
    log('failover · does the message still get through on NKN alone?',
      arrivedAfter ? 'PASS' : 'FINDING',
      arrivedAfter ? `the ladder fell back — it arrived after ~${arrivedAfter}s` : `${after.length} bubble(s) — nothing in 90s`);
    log('failover · what the transports said while it happened', 'OBSERVED',
      JSON.stringify([...new Set(lines.filter((t) => /failing over|failed for|routing across/i.test(t)))].slice(0, 4)));
  } finally { await teardown(peers); }
});

/**
 * I3 — THE RELAY DIES MID-CONVERSATION, WITH NOTHING RELOADED.
 *
 * Test 3 above answers a different question than it looks like it answers. `routeWebSocket` intercepts
 * NEW connections, so an already-open relay socket survives it — which is why that test reloads both
 * peers, and why what it really measures is "can the app BOOT and carry a message with the relay already
 * unreachable". A reload rebuilds every transport from scratch; the ladder is never asked to step down.
 *
 * The ladder's actual job is the case no test covered: two peers mid-conversation, sockets open, and the
 * relay goes away underneath them. `onTransportFailure` only fires when a send THROWS
 * (`createSecureAgent.js`), so the open question is whether a send into a dead relay throws at all, or
 * reports success into a socket nobody is reading.
 *
 * Killing the relay PROCESS is the honest way to ask: it is a real outage rather than a simulated one,
 * and it is the only thing that takes an open socket away without touching NKN. The fixture attaches to
 * an already-listening relay and leaves it alone on teardown, so the port belongs to whoever started it.
 */
test('transports 4 — the relay DIES mid-conversation (nothing reloaded)', async ({ browser }) => {
  const relayUrl = process.env.PEER_TEST_RELAY || '';
  const relayPort = (relayUrl.match(/:(\d+)/) ?? [])[1] ?? null;
  test.skip(!relayPort, 'needs PEER_TEST_RELAY — this test is about losing a relay that exists');

  const peers = await bootPeers(browser, 2, { transportMode: 'both' });
  const [A, B] = peers;
  const lines = [];
  listen(A, lines); listen(B, lines);
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Dode Relay Kring', re: /dode.?relay/i, handle: 'sanne' });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);
    const byId = new RegExp(`dode.?relay|${gid}`, 'i');
    await openCircleMatching(B.page, byId).catch(() => {});
    await toChat(B.page); await toChat(A.page);

    await sendChat(A.page, 'RELAY-LEEFT-NOG');
    await B.page.waitForTimeout(8000);
    expect((await readBubbles(B.page)).some((t) => /RELAY-LEEFT-NOG/.test(t)), 'the baseline must cross').toBe(true);
    log('live-drop · baseline while the relay lives', 'PASS', 'a message crosses');

    // THE DROP. No reload, no navigation: the process simply stops answering, exactly as an outage would.
    let killed = false;
    try {
      // `-sTCP:LISTEN` matters: a bare `lsof -ti:PORT` also matches every CLIENT socket on that port,
      // which here includes the browsers themselves — the first run of this test killed a peer's own
      // process and reported the resulting blank page as "the app dies when the relay dies". Kill the
      // listener, nothing else.
      const pids = execSync(`lsof -ti:${relayPort} -sTCP:LISTEN || true`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      for (const pid of pids) { try { execSync(`kill ${pid}`); killed = true; } catch { /* already gone */ } }
    } catch { /* reported below */ }
    // "kill returned 0" is not "the relay is gone" — a probe that cannot name its branch is not
    // evidence. Wait until NOTHING listens on the port, and say so; and from here on capture EVERY
    // console line on both peers, unfiltered, because the question is precisely what the transport
    // said (or did not say) while the socket died under it.
    let portClosed = false;
    for (let i = 0; i < 20 && !portClosed; i += 1) {
      const still = execSync(`lsof -ti:${relayPort} -sTCP:LISTEN || true`, { encoding: 'utf8' }).trim();
      if (!still) portClosed = true; else await A.page.waitForTimeout(500);
    }
    log('live-drop · was the relay actually killed?', killed && portClosed ? 'PASS' : 'BLOCKED',
      killed && portClosed ? `port ${relayPort} has no listener` : `kill=${killed} portClosed=${portClosed}`);
    test.skip(!(killed && portClosed), 'could not take the relay away');
    const everything = [];
    for (const peer of peers) {
      peer.page.on('console', (m) => everything.push(`[${peer.label}] ${m.type()} ${m.text().slice(0, 160)}`));
    }
    await A.page.waitForTimeout(6000);   // let the socket death reach the app

    // Does the SENDER still have a composer once the relay dies? The first run of this test failed here
    // with "waiting for .circle-view__composer-input" — which is either a real finding (the screen
    // changes under you when a transport dies) or the view simply not being in chat mode. A probe that
    // cannot tell those apart is not evidence, so ask, say which, and then carry on either way.
    const composerStillThere = await A.page.locator('.circle-view__composer-input').count() > 0;
    log('live-drop · can the sender still type after the relay dies?',
      composerStillThere ? 'PASS' : 'FINDING',
      composerStillThere ? 'the composer is still on screen' : 'the composer is GONE without any reload');
    if (!composerStillThere) {
      const seen = await A.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200));
      log('live-drop · what the sender sees instead', 'OBSERVED', seen);
      await gotoCircles(A.page).catch(() => {});
      await openCircleMatching(A.page, byId).catch(() => {});
      await toChat(A.page).catch(() => {});
    }
    if (!(await A.page.locator('.circle-view__composer-input').count())) {
      log('live-drop · could the walk get back to a composer at all?', 'BLOCKED', 'no composer after re-navigating');
      return;
    }
    await sendChat(A.page, 'NA-DE-DOOD');
    // NKN is already connected here (both peers booted `both` and nothing reloaded), so this should not
    // need a cold bootstrap. Poll long enough that a slow rung still counts, and report WHEN.
    let arrivedAfter = null;
    for (let i = 1; i <= 18; i += 1) {
      await B.page.waitForTimeout(5000);
      await toChat(B.page).catch(() => {});
      if ((await readBubbles(B.page)).some((t) => /NA-DE-DOOD/.test(t))) { arrivedAfter = i * 5; break; }
    }
    log('live-drop · does the ladder step down while the app is running?',
      arrivedAfter ? 'PASS' : 'FINDING',
      arrivedAfter
        ? `it arrived after ~${arrivedAfter}s on NKN, with nothing reloaded`
        : 'nothing in 90s — a live relay death is not survived, only a cold boot without one');
    // The transport's own words settle WHERE it stops: a send that throws produces "failing over"; a send
    // that reports success into a dead socket produces silence, and that is a different fix.
    const said = [...new Set(lines.filter((t) => /failing over|failed for|routing across|relay/i.test(t)))];
    log('live-drop · what the transports said', 'OBSERVED', JSON.stringify(said.slice(0, 6)));
    // The unfiltered record, so the NEXT reading of this run can be from evidence rather than absence.
    log('live-drop · EVERY console line after the drop (both peers)', 'OBSERVED',
      `${everything.length} lines\n` + everything.slice(0, 80).join('\n'));
    log('live-drop · did any send report a failure at all?',
      said.some((t) => /failing over|failed for/i.test(t)) ? 'PASS' : 'FINDING',
      said.some((t) => /failing over|failed for/i.test(t))
        ? 'the send threw and the ladder was asked to step down'
        : 'no failure line — the send into the dead relay reported success, so nothing asked the ladder');
  } finally { await teardown(peers); }
});
