/**
 * SYNCING THROUGH A POD (the function matrix's pod-sync × web cell): two members of a SHARED-POD circle. B is away when
 * A posts; A stops; B comes back and reads A's post FROM THE POD. The source is asserted, not only the arrival: B comes
 * back with every WebSocket closed (the relay cannot reach B's page), so the only way in is the pod, and B's page is
 * seen reading the pod.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-pod-sync.spec.js
 *
 * Needs the local Community Solid Server (scripts/css-harness.mjs, ACP).
 */
import { test, expect } from '@playwright/test';
import { bootCss, teardown as podTeardown, provisionAll, reachable } from '../../../scripts/css-harness.mjs';
import { bootPeers, teardown, gotoCircles, openCircleMatching, getInvite, joinFromInvite, toChat, sendChat, readBubbles, tileNames, log } from './peerHarness.js';
import { signIn, podResourceCount, createWithStorage, call } from './podWalk.js';

test.setTimeout(600_000);
const PORT = 3058;
const BASE = `http://localhost:${PORT}/`;
const NAME = 'Kring pod samen';
const RE = /kring pod samen/i;

test('a member who was away reads the post from the pod, with the relay out of reach', async ({ browser }) => {
  let css = null;
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    css = await bootCss({ port: PORT, base: BASE, config: '@css:config/file-acp.json' });
    expect(await reachable(BASE), 'the pod is up').toBeTruthy();
    const { accounts } = await provisionAll(BASE, 'ps');
    await signIn(A.page, BASE, 'psown@ex.com');
    await signIn(B.page, BASE, 'psbob@ex.com');

    // A makes a shared-pod circle in the wizard; B joins
    const gid = await createWithStorage(A.page, NAME, { storage: 'shared', podUri: `${accounts.owner.podRoot}circles/${PORT}/` });
    expect((await call(A.page, 'pinboard', 'getCircleStoragePolicy', { groupId: gid }))?.policy).toBe('shared');
    await A.page.reload();
    await expect.poll(async () => { await gotoCircles(A.page); return (await tileNames(A.page)).some((t) => RE.test(t)); }, { timeout: 60_000, intervals: [2000] }).toBe(true);
    await openCircleMatching(A.page, RE);
    const invite = await getInvite(A.page);
    expect(invite).toBeTruthy();
    await gotoCircles(B.page);
    const joined = await joinFromInvite(B.page, invite, { handle: 'bram' });
    expect(joined.joined, JSON.stringify(joined)).toBe(true);
    // a first line both ways settles the membership on both devices before B goes
    await gotoCircles(A.page); await openCircleMatching(A.page, RE); await toChat(A.page);
    await sendChat(A.page, 'EERSTE-pod');
    await expect.poll(async () => { await gotoCircles(B.page); if (!(await tileNames(B.page)).some((t) => RE.test(t))) return false; await openCircleMatching(B.page, RE); await toChat(B.page); return (await readBubbles(B.page)).some((t) => t.includes('EERSTE-pod')); },
      { timeout: 90_000, intervals: [3000], message: 'B reads the first line while present' }).toBe(true);
    log('STEP1 a shared-pod circle, both members present', 'PASS', '');

    // B goes away
    const bUrl = B.page.url();
    await B.page.close();
    // A posts while B is away; the pod holds it
    const before = await podResourceCount(A.page, accounts.owner.podRoot);
    const text = `TERWIJL-WEG-${Date.now().toString(36)}`;
    await sendChat(A.page, text);
    await expect.poll(() => podResourceCount(A.page, accounts.owner.podRoot), { timeout: 30_000, intervals: [1500], message: "A's post is in the pod" }).toBeGreaterThan(before);
    log('STEP2 B away; A posted; the pod holds it', 'PASS', '');
    // A stops
    await A.page.close();
    log('STEP3 A stopped', 'PASS', '');

    // B comes back with the relay out of reach: every WebSocket the page opens is closed, so only the pod can bring it
    const closedSockets = [];
    await B.context.routeWebSocket(/.*/, (ws) => { closedSockets.push(ws.url()); ws.close(); });
    const podReads = [];
    const back = await B.context.newPage();
    back.on('request', (r) => { if (r.url().startsWith(BASE) && /circles\//.test(r.url())) podReads.push(r.url()); });
    await back.goto(bUrl);
    await expect.poll(async () => { await gotoCircles(back); if (!(await tileNames(back)).some((t) => RE.test(t))) return false; await openCircleMatching(back, RE); await toChat(back); return (await readBubbles(back)).some((t) => t.includes(text)); },
      { timeout: 150_000, intervals: [5000], message: "B, back with no relay, reads A's post" }).toBe(true);
    expect(closedSockets.length, 'the page did try its relay (and it was closed): the relay was really out of reach').toBeGreaterThan(0);
    expect(podReads.length, "B's page read the circle's pod").toBeGreaterThan(0);
    log('STEP4 B, back with no relay, read the post from the pod', 'PASS', `${podReads.length} pod reads, ${closedSockets.length} sockets closed`);
  } finally {
    await teardown(peers);
    if (css) { try { podTeardown(css); } catch { /* best-effort */ } }
  }
});
