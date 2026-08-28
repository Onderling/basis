/**
 * walk-pod.spec.js — story 9's other half: a circle whose content lives in a pod.
 *
 * Frits: *"could you do story 9's pod half? As you are able to host pods locally too."* Yes — the
 * integration and journey tiers both boot a Community Solid Server through `scripts/css-harness.mjs`,
 * and nothing stopped a browser walk using the same one. I had filed this as "needs setup" without
 * checking how much setup, which is the same shortcut that had me call NKN untestable.
 *
 * The pod must be **ACP-configured** (decided 2026-08-26): on a WAC pod, circle sharing silently grants
 * nothing and members cannot read their own circle — so a walk against WAC would produce confident
 * nonsense.
 */
import { test } from '@playwright/test';
import { bootCss, teardown as podTeardown, provisionAll, reachable } from '../../../scripts/css-harness.mjs';
import { bootPeers, teardown, pair, toChat, sendChat, readBubbles, log,
  gotoCircles, openCircleMatching } from './peerHarness.js';

test.setTimeout(600_000);

const surface = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;

test('story 9 (pod half) — a circle backed by a real Solid pod', async ({ browser }) => {
  const port = 3055;
  // TRAILING SLASH REQUIRED: `reachable()` fetches `${base}.account/`, so a base without one becomes
  // `http://localhost:3055.account/` — a malformed host that never resolves. The pod was up and running
  // the whole time I was reporting "CSS did not come up"; the runners that work all pass the slash.
  const base = `http://localhost:${port}/`;
  let css = null;
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    // ACP, not WAC — on WAC the sharing silently grants nothing and every result below would be a lie.
    css = await bootCss({ port, base, config: '@css:config/file-acp.json' }).catch((e) => {
      log('pod · could a pod be booted at all?', 'BLOCKED', String(e?.message ?? e).slice(0, 160));
      return null;
    });
    const up = css ? await reachable(base).catch(() => false) : false;
    log('pod · is the pod up?', up ? 'PASS' : 'BLOCKED', up ? `${base} (ACP)` : 'no pod — the rest is unmeasurable');
    test.skip(!up, 'no pod');

    const accounts = await provisionAll(base, 'walk').catch((e) => {
      log('pod · provisioning accounts', 'BLOCKED', String(e?.message ?? e).slice(0, 160));
      return null;
    });
    log('pod · accounts provisioned', accounts ? 'PASS' : 'BLOCKED', JSON.stringify(Object.keys(accounts ?? {})));

    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Pod Kring', re: /pod.?kring/i, handle: 'bram' });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);
    const byId = new RegExp(`pod.?kring|${gid}`, 'i');

    // What does the app say the circle's storage is, before anyone changes it?
    const before = await call(A.page, 'stoop', 'getCircleStoragePolicy', { groupId: gid });
    log('pod · the circle\'s storage posture out of the box', 'OBSERVED', JSON.stringify(before)?.slice(0, 160));

    // Point it at the pod. `shared` is the posture that needs a groupPodUri — the one rule the
    // vocabulary carries.
    const set = await call(A.page, 'stoop', 'setCircleStoragePolicy', {
      groupId: gid, storagePolicy: 'shared', groupPodUri: `${base}walk-owner/circles/${gid}/`,
    });
    log('pod · can a circle be pointed at a pod?', set?.error ? 'FINDING' : 'PASS', JSON.stringify(set)?.slice(0, 200));

    const after = await call(A.page, 'stoop', 'getCircleStoragePolicy', { groupId: gid });
    log('pod · …and does it stick?', JSON.stringify(after ?? '').includes('shared') ? 'PASS' : 'FINDING',
      JSON.stringify(after)?.slice(0, 200));

    // The question the story asks: with a pod attached, does the circle still work — and can the other
    // member read what was written?
    await openCircleMatching(A.page, byId).catch(() => {});
    await toChat(A.page);
    await sendChat(A.page, 'BERICHT-MET-POD');
    await B.page.waitForTimeout(9000);
    await openCircleMatching(B.page, byId).catch(() => {});
    await toChat(B.page);
    const got = await readBubbles(B.page);
    log('pod · does a message still reach the other member?',
      got.some((t) => /BERICHT-MET-POD/.test(t)) ? 'PASS' : 'FINDING', `${got.length} bubble(s)`);

    // …and is it clear to a person WHERE their data now lives? Story 9's own finding line.
    const s = await surface(A.page);
    const storageOps = (s?.actions ?? []).filter((a) => /storage|pod/i.test(a.opId)).map((a) => a.opId);
    log('pod · what a person is offered about storage', storageOps.length ? 'OBSERVED' : 'FINDING',
      JSON.stringify(storageOps));
  } finally {
    await teardown(peers);
    if (css) { try { podTeardown(css); } catch { /* best-effort */ } }
  }
});
