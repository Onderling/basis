/**
 * CIRCLE TYPES — each type made the way a person makes it, in the create wizard, and a member's message reaching the
 * other member, with the BRANCH the send took asserted beside the message.
 *
 *   normal       storage 'none'      the radio left at its default: the plain fan-out, silently — no degrade line
 *   shared pod   storage 'shared'    a signed-in founder: the send writes the circle's pod and fans a pointer
 *   pod-only     storage 'personal'  both members signed in: the send writes the pod, no fan
 *   pod type, no session  'shared' with nobody signed in: today the send degrades to the fan-out and SAYS so. This is
 *                the case that will become a normal circle once a circle without a pod is made as one; then it goes.
 *
 * The wizard's STORAGE radio is what gives a circle its type (the kind picked on its first step only prefers one;
 * the radio is the authority, default "No pod"). The type is fixed when the circle is made.
 *
 * The branch is read two ways: what the founder's send path says (it logs every degrade), and whether the founder's
 * pod gained a resource. A pod type with neither a write nor a degrade line would be a send this walk cannot name —
 * so that fails too.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-circle-types-pod.spec.js
 *
 * Needs the local Community Solid Server (scripts/css-harness.mjs, ACP — on WAC the sharing grants nothing).
 */
import { test, expect } from '@playwright/test';
import { bootCss, teardown as podTeardown, provisionAll, reachable } from '../../../scripts/css-harness.mjs';
import { bootPeers, teardown, gotoCircles, openCircleMatching, getInvite, joinFromInvite, toChat, sendChat, readBubbles, tileNames } from './peerHarness.js';
import { call, signIn, podResourceCount, createWithStorage } from './podWalk.js';

test.setTimeout(600_000);

const CASES = [
  { type: 'normal', storage: 'none', port: null, signA: false, signB: false, branch: 'fan-out' },
  { type: 'shared pod', storage: 'shared', port: 3056, signA: true, signB: true, branch: 'pod', },
  // pod-only is OUT FOR THE ALPHA (decision 2026-11-13 in docs/decisions.md: what a person can make is normal and shared pod); its two
  // relay walks pin what it does. Kept here, skipped with that reason, for the day it comes back.
  { type: 'pod-only', storage: 'personal', port: 3057, signA: true, signB: true, branch: 'pod', outOfAlpha: 'pod-only is not a circle type a person makes in the alpha (decision 2026-11-13); its relay walks pin it' },
  // without a pod session the wizard offers no pod type: the circle is made a normal one and says nothing about pods
  { type: 'no pod session', storage: 'none', port: null, signA: false, signB: false, branch: 'fan-out', onlyNone: true },
];

for (const c of CASES) {
  // a case that cannot pass yet is named as such, with its reason — it is not a green cell; a type out of the alpha is
  // skipped with the decision as its reason
  if (c.outOfAlpha) { test.skip(`${c.type}: out of the alpha`, () => {}); continue; }
  (c.blocked ? test.fixme : test)(`${c.type}: made in the wizard, a member's message reaches the other member, and the send took its branch`, async ({ browser }) => {
    const base = c.port ? `http://localhost:${c.port}/` : null;
    let css = null;
    const peers = await bootPeers(browser, 2);
    const [A, B] = peers;
    const sendLog = [];
    A.page.on('console', (m) => { const t = m.text(); if (t.includes('[broadcastToCircle]')) sendLog.push(t); });
    const refusedRules = [];   // a member's device writing the founder's access rules, refused by the pod
    B.page.on('console', (m) => { const t = m.text(); if (/writing \.acr for .* failed \[403\]/.test(t)) refusedRules.push(t.slice(0, 200)); });
    try {
      let accounts = null;
      const tag = `ct${c.port ?? 'none'}`;
      if (base) {
        css = await bootCss({ port: c.port, base, config: '@css:config/file-acp.json' });
        expect(await reachable(base), 'the pod is up').toBeTruthy();
        ({ accounts } = await provisionAll(base, tag));
      }
      if (c.signA) await signIn(A.page, base, `${tag}own@ex.com`);
      if (c.signB) await signIn(B.page, base, `${tag}bob@ex.com`);

      const name = `Kring ${c.storage} ${c.port ?? 'los'}`;
      const podUri = c.storage === 'shared' ? `${accounts.owner.podRoot}circles/${c.port}/` : null;
      const offered = [];
      const gid = await createWithStorage(A.page, name, { storage: c.storage, podUri, offered });
      if (c.onlyNone) expect(offered, 'without a pod session the wizard offers only a normal circle').toEqual(['none']);
      expect((await call(A.page, 'pinboard', 'getCircleStoragePolicy', { groupId: gid }))?.policy, 'the circle has the type the radio gave it').toBe(c.storage);

      // the launcher reads its list after the boot: reload, then wait for the new circle's tile before opening it
      await A.page.reload();
      await expect.poll(async () => { await gotoCircles(A.page); return (await tileNames(A.page)).some((t) => new RegExp(name, 'i').test(t)); },
        { timeout: 60_000, intervals: [2000], message: "the new circle is not on the founder's launcher" }).toBe(true);
      await openCircleMatching(A.page, new RegExp(name, 'i'));
      const invite = await getInvite(A.page);
      expect(invite, 'the founder can invite').toBeTruthy();
      await gotoCircles(B.page);
      const joined = await joinFromInvite(B.page, invite, { handle: 'bram' });
      expect(joined.joined, JSON.stringify(joined)).toBe(true);

      const podBefore = c.signA ? await podResourceCount(A.page, accounts.owner.podRoot) : null;
      await gotoCircles(A.page);
      await openCircleMatching(A.page, new RegExp(name, 'i'));
      await toChat(A.page);
      const text = `BERICHT-${c.storage}-${c.port ?? 'los'}`;
      await sendChat(A.page, text);
      await expect.poll(async () => { await gotoCircles(B.page); return (await tileNames(B.page)).some((t) => new RegExp(name, 'i').test(t)); },
        { timeout: 60_000, intervals: [2000], message: "the joined circle is not on the member's launcher" }).toBe(true);
      await openCircleMatching(B.page, new RegExp(name, 'i'));
      await toChat(B.page);
      await expect.poll(async () => (await readBubbles(B.page)).some((t) => t.includes(text)),
        { timeout: 60_000, intervals: [2500], message: `the other member reads the message in a ${c.type} circle` }).toBe(true);

      if (c.type === 'shared pod') expect(refusedRules, 'the member\'s device tried to write the founder\'s access rules').toEqual([]);
      const degraded = sendLog.filter((l) => /degrading to fan-out-full/.test(l));
      if (c.branch === 'fan-out') {
        expect(degraded, `a normal circle must not talk about a pod:\n${sendLog.join('\n')}`).toEqual([]);
      } else {
        expect(degraded, `the ${c.type} send degraded instead of using the pod`).toEqual([]);
        const podAfter = await podResourceCount(A.page, accounts.owner.podRoot);
        expect(podAfter, `the founder's pod gained nothing from the send (before ${podBefore})`).toBeGreaterThan(podBefore);
      }
    } finally {
      await teardown(peers);
      if (css) { try { podTeardown(css); } catch { /* best-effort */ } }
    }
  });
}
