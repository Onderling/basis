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
import { fillFounderHandle } from './helpers.js';

test.setTimeout(600_000);

const PW = 'pw-123456';
const call = (page, app, opId, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const myCircles = async (page) => ((await call(page, 'pinboard', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);

/** Sign the page into the local pod through the app's own sign-in (the redirect flow a person takes). */
async function signIn(page, issuer, email) {
  await page.evaluate((iss) => { window.onderlingPodSignIn(iss); }, issuer);
  await page.waitForURL((u) => u.href.startsWith(issuer), { timeout: 30_000 });
  const login = page.locator('#email');
  if (!(await login.isVisible().catch(() => false))) {
    // the account page first: take the password login
    const pw = page.locator('a[href*="login/password"]');
    if (await pw.count()) await pw.first().click();
  }
  await login.waitFor({ timeout: 20_000 });
  await login.fill(email);
  await page.locator('#password').fill(PW);
  await page.locator('button[type="submit"][name="submit"]').click();
  const authorize = page.locator('#authorize');
  await authorize.waitFor({ timeout: 30_000 });
  await expect(authorize).toBeEnabled({ timeout: 15_000 });
  await authorize.click();
  await page.waitForURL((u) => !u.href.startsWith(issuer), { timeout: 60_000 });
  const webid = await expect.poll(() => page.evaluate(() => window.onderlingPodSession?.webid ?? null),
    { timeout: 90_000, intervals: [1000], message: `the app never held a pod session for ${email}` }).toBeTruthy();
  return webid;
}

/** Every resource under a container, through the founder's own authenticated fetch (ld+json listing). */
async function podResourceCount(page, root) {
  return page.evaluate(async (start) => {
    const f = window.onderlingPodSession?.fetch;
    if (typeof f !== 'function') return -1;
    const seen = new Set(); const queue = [start];
    while (queue.length && seen.size < 400) {
      const uri = queue.shift();
      if (seen.has(uri)) continue;
      seen.add(uri);
      if (!uri.endsWith('/')) continue;
      try {
        const r = await f(uri, { headers: { accept: 'application/ld+json' } });
        if (!r.ok) continue;
        const doc = await r.json();
        const nodes = Array.isArray(doc) ? doc : (doc['@graph'] ?? [doc]);
        for (const n of nodes) {
          for (const c of [].concat(n['http://www.w3.org/ns/ldp#contains'] ?? n.contains ?? n['ldp:contains'] ?? [])) {
            const id = typeof c === 'string' ? c : c?.['@id'];
            if (id) queue.push(new URL(id, uri).href);
          }
        }
      } catch { /* an unreadable container counts as itself */ }
    }
    return seen.size;
  }, root);
}

/** The create wizard, with the storage radio set; returns the new circle's id. */
async function createWithStorage(page, name, { storage, podUri = null, handle = 'anna', offered = null }) {
  const before = new Set(await myCircles(page));
  await gotoCircles(page);
  await page.locator('.circle-launcher__new').click();
  await page.locator('.cc-wizard-input:visible').first().waitFor({ timeout: 15_000 });
  await page.locator('.cc-wizard-input:visible').nth(0).fill(name);
  await fillFounderHandle(page, handle);
  // the kind, asked on the first step (never assumed)
  await page.locator('input[type="radio"][value="household"]:visible').first().check();
  // the storage choice lives behind the first step's "advanced" fold; opened, the wizard walks every step
  await page.locator('details[data-role="advanced"] > summary').first().click();
  await page.waitForTimeout(500);
  let picked = false;
  for (let step = 0; step < 12; step += 1) {
    if (Array.isArray(offered)) {
      for (const v of await page.locator('input[type="radio"]:visible').evaluateAll((els) => els.map((e) => e.value))) {
        if (['none', 'personal', 'shared', 'hybrid'].includes(v) && !offered.includes(v)) offered.push(v);
      }
    }
    const radio = page.locator(`input[type="radio"][value="${storage}"]:visible`);
    if (!picked && await radio.count()) {
      await radio.first().click({ force: true });
      picked = true;
      await page.waitForTimeout(800);
      expect(await radio.first().isChecked(), `the storage radio "${storage}" did not take the click`).toBe(true);
      if (podUri) {
        const field = page.locator('.cc-wizard-field').filter({ hasText: /pod address|pod-adres/i }).locator('input');
        await field.first().waitFor({ timeout: 10_000 });
        await field.first().fill(podUri);
      }
    }
    const advance = page.locator('.cc-wizard-btn:visible').filter({ hasText: /next|review|create|volgende|overzicht|controle|maken/i });
    if (await advance.count() === 0) break;
    const label = (await advance.first().textContent() ?? '').trim();
    await advance.first().click();
    await page.waitForTimeout(1200);
    if (/create|maken/i.test(label)) break;
  }
  expect(picked, `the wizard never offered the storage choice "${storage}"`).toBe(true);
  const done = page.locator('button:visible').filter({ hasText: /^(done|klaar)$/i });
  await done.first().waitFor({ timeout: 30_000 }).catch(() => {});
  if (await done.count()) await done.first().click();
  const id = await expect.poll(async () => (await myCircles(page)).find((c) => !before.has(c)) ?? null,
    { timeout: 30_000, intervals: [1000], message: 'the wizard made no circle' }).not.toBeNull().then(async () => (await myCircles(page)).find((c) => !before.has(c)));
  return id;
}

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
