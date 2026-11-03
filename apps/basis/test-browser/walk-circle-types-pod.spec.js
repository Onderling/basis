/**
 * CIRCLE TYPES, ON A REAL POD — a circle made with its content in a pod still carries a member's message to the other
 * member. Two of the three circle types (Frits's alpha one functions): CENTRAL POD (storage 'shared': the content in the
 * circle's pod, members told by a signal and catching up from it) and POD-ONLY (storage 'personal': the content only in
 * the pod). The third, NORMAL ('none', fan-out), is journeys.spec 'fan-out'.
 *
 * A circle gets its type WHEN IT IS MADE (the wizard's storage choice; changing it afterwards is refused —
 * 'storage-policy-writer-unavailable', podCircleJourneys). So each test makes its circle with the type, the other
 * browser joins from the invite, and a message must arrive — asserted, not logged.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-circle-types-pod.spec.js
 *
 * Needs the local Community Solid Server (scripts/css-harness.mjs, ACP — on WAC the sharing grants nothing).
 */
import { test, expect } from '@playwright/test';
import { bootCss, teardown as podTeardown, provisionAll, reachable } from '../../../scripts/css-harness.mjs';
import { bootPeers, teardown, gotoCircles, openCircleMatching, getInvite, joinFromInvite, toChat, sendChat, readBubbles, tileNames } from './peerHarness.js';

test.setTimeout(600_000);

const call = (page, app, opId, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);

for (const [type, storagePolicy, port] of [['central pod', 'shared', 3056], ['pod-only', 'personal', 3057]]) {
  test(`${type}: a circle made with its content in a pod carries a member's message to the other member`, async ({ browser }) => {
    const base = `http://localhost:${port}/`;
    let css = null;
    const peers = await bootPeers(browser, 2);
    const [A, B] = peers;
    try {
      css = await bootCss({ port, base, config: '@css:config/file-acp.json' });
      expect(await reachable(base), 'the pod is up').toBeTruthy();
      expect(await provisionAll(base, `ct-${storagePolicy}`), 'the pod accounts are provisioned').toBeTruthy();

      const gid = `ct-${storagePolicy}-${Date.now().toString(36)}`;
      const name = `Kring ${storagePolicy}`;
      await gotoCircles(A.page);
      const made = await call(A.page, 'pinboard', 'createGroupV2', {
        groupId: gid, name, rules: { text: 't' }, storagePolicy, groupPodUri: `${base}ct-${storagePolicy}-owner/circles/${gid}/`,
      });
      expect(made?.error ?? null, JSON.stringify(made)).toBe(null);
      expect((await call(A.page, 'pinboard', 'getCircleStoragePolicy', { groupId: gid }))?.policy, 'the circle has its type').toBe(storagePolicy);

      await A.page.reload();
      await gotoCircles(A.page);
      // the launcher reads its list after the boot: wait for the new circle's tile before opening it
      await expect.poll(async () => (await tileNames(A.page)).some((t) => new RegExp(name, 'i').test(t)),
        { timeout: 60_000, intervals: [2000], message: 'the pod circle is on the founder\'s launcher' }).toBe(true);
      await openCircleMatching(A.page, new RegExp(name, 'i'));
      const invite = await getInvite(A.page);
      expect(invite, 'the founder can invite into a pod circle').toBeTruthy();
      await gotoCircles(B.page);
      const joined = await joinFromInvite(B.page, invite, { handle: 'bram' });
      expect(joined.joined, JSON.stringify(joined)).toBe(true);

      await openCircleMatching(A.page, new RegExp(name, 'i'));
      await toChat(A.page);
      await sendChat(A.page, `BERICHT-${storagePolicy}`);
      await openCircleMatching(B.page, new RegExp(name, 'i'));
      await toChat(B.page);
      await expect.poll(async () => (await readBubbles(B.page)).some((t) => t.includes(`BERICHT-${storagePolicy}`)),
        { timeout: 60_000, intervals: [2500], message: `the other member reads the message in a ${type} circle` }).toBe(true);
    } finally {
      await teardown(peers);
      if (css) { try { podTeardown(css); } catch { /* best-effort */ } }
    }
  });
}
