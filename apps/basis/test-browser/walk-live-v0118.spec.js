/**
 * THE OWED WALKS, ON THE LIVE BUILD — https://onderling.org/basis over wss://relay.onderling.org (2026-09-23).
 *
 * Not the harness: the published bytes, the public relay, three browser contexts. A throwaway person (two of
 * their devices, enrolled by the real add-a-device ceremony) and a second person who is in their circle — so the
 * two claims of v0.1.18 can be asserted where they matter:
 *   (1) A LEAVE TRAVELS   — the other member's roster loses the leaver (it did not, from web/mobile, before this release);
 *   (2) A LEAVE FOLLOWS   — the person's other device leaves the circle too, without being told by hand;
 *   (3) SHARE TO A CIRCLE — a disclosed property said on the lane lands on a co-member's roster row, and withdrawing it takes it away.
 *
 * Nothing here touches Frits' account: the identities are fresh per run and the circle is created here.
 * Run: LIVE_WALK=1 npx playwright test --project=relay test-browser/walk-live-v0118.spec.js
 *
 * STEP4b (taking a disclosure back) is RED until v0.1.19 is published: the fix is on `development` and the live
 * site is what it is. That is the point of a live walk — it says what is out there, not what is in the branch.
 */
import { test, expect } from '@playwright/test';
import { gotoCircles, createCircle, getInvite, joinFromInvite, openCircleMatching, toChat } from './peerHarness.js';

const APP = process.env.LIVE_APP_URL || 'https://onderling.org/basis/';
test.skip(!process.env.LIVE_WALK, 'set LIVE_WALK=1 to walk the live build');

const call = (page, app, op, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall(a, o, g), [app, op, args]);
const log = (step, verdict, detail = '') => console.log(`### ${step}: ${verdict}${detail ? ` — ${detail}` : ''}`);
const until = async (fn, { timeout = 45_000, step = 1500 } = {}) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* keep trying */ }
    if (Date.now() - t0 > timeout) return null;
    await new Promise((r) => { setTimeout(r, step); });
  }
};
async function boot(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => { const t = m.text(); if (/refused a validly|circle-follow|\[own-devices\]|error/i.test(t)) console.log(`[${label}] ${t.slice(0, 200)}`); });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(6000);   // let the relay dial + the boot kicks run
  return { ctx, page, label };
}
const myCircles = async (page) => (await call(page, 'stoop', 'listMyCircles', {}))?.circles ?? [];
const rosterOf = async (page, gid) => ((await call(page, 'stoop', 'listGroupMembers', { groupId: gid }))?.members ?? []);

test('v0.1.18 on the live build: a leave travels, a leave follows, and a disclosure lands', async ({ browser }) => {
  test.setTimeout(600_000);
  const A = await boot(browser, 'A(dev1)');
  const B = await boot(browser, 'B(other person)');
  let A2 = null;
  try {
    const aWho = await call(A.page, 'stoop', 'whoAmI', {});
    const bWho = await call(B.page, 'stoop', 'whoAmI', {});
    expect(aWho?.webid, 'A has an identity').toBeTruthy();
    expect(bWho?.webid, 'B has an identity').toBeTruthy();
    expect(aWho.webid).not.toBe(bWho.webid);
    log('STEP1 two people boot the live app', 'PASS', `${String(aWho.webid).slice(0, 10)}… · ${String(bWho.webid).slice(0, 10)}…`);

    // ── A makes a circle and B joins it (the real invite chain) ────────────────────────────────────
    // the REAL chain: the create wizard, the ⋯ invite, the join wizard — the same DOM a person drives
    const name = `Live walk ${Date.now().toString(36).slice(-4)}`;
    await gotoCircles(A.page);
    await createCircle(A.page, name);
    await openCircleMatching(A.page, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    await toChat(A.page);
    const invite = await getInvite(A.page, 'live-invite');
    expect(invite, 'A could mint an invite').toBeTruthy();
    await gotoCircles(B.page);
    const r = await joinFromInvite(B.page, invite, { handle: 'bea', tag: 'live-join' });
    log('STEP2 B joins', r?.joined ? 'PASS' : 'FINDING', JSON.stringify(r)?.slice(0, 160));
    const gid = await until(async () => {
      const mine = await myCircles(A.page);
      return mine.find((c) => !/^pair-|^cc-help$/.test(String(c))) ?? null;
    });
    expect(gid, 'the circle id').toBeTruthy();
    const bIn = await until(async () => ((await myCircles(B.page)).includes(gid) ? true : null), { timeout: 90_000 });
    expect(bIn, 'B is in the circle').toBe(true);
    const aSeesB = await until(async () => ((await rosterOf(A.page, gid)).some((m) => m.webid === bWho.webid) ? true : null));
    expect(aSeesB, "A's roster names B").toBe(true);
    log('STEP2 B joins', 'PASS', `${gid} has both`);

    // ── A's SECOND DEVICE, by the real add-a-device ceremony ───────────────────────────────────────
    const offer = await call(A.page, 'household', 'buildEnrollOffer', { relayUrl: 'wss://relay.onderling.org' });
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await call(A.page, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase, 'the phrase is readable on A').toBeTruthy();
    A2 = await boot(browser, 'A(dev2)');
    const enrolled = await A2.page.evaluate(async ([uri, words]) => {
      localStorage.setItem('onderling.enrollOffer', uri);
      return window.onderlingCall('household', 'enrollDevice', { mnemonic: words, label: 'walk-dev2' });
    }, [offer.uri, phrase]);
    expect(enrolled?.ok, JSON.stringify(enrolled)).toBe(true);
    await A2.page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => A2.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
    const a2In = await until(async () => ((await myCircles(A2.page)).includes(gid) ? true : null), { timeout: 90_000 });
    expect(a2In, "A's second device consumed the offer and is in the circle").toBe(true);
    const a2Who = await call(A2.page, 'stoop', 'whoAmI', {});
    expect(a2Who?.webid, 'the second device is the SAME person').toBe(aWho.webid);
    log('STEP3 A enrols a second device', 'PASS', 'same person, in the circle');

    // ── (3) SHARE TO THIS CIRCLE — a disclosure said on the lane lands on B's roster row ───────────
    await call(A.page, 'agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' });
    await call(A.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: gid, key: 'place', enabled: true });
    // through the real button (Mij → persona's → "Share to this circle"), as a person does
    const closePanel = async (page) => {
      const x = page.locator('.cc-screen-panel__close');
      if (await x.count()) { await x.first().click(); await page.waitForTimeout(1200); }
    };
    const pressShare = async () => {
      await closePanel(A.page);
      await gotoCircles(A.page);
      await A.page.locator('[data-tab="mij"]').first().click();
      await A.page.waitForTimeout(1500);
      await A.page.locator('.cc-profile__offerings-moved-link').first().click();
      await A.page.waitForTimeout(2500);
      const btn = A.page.locator('.cc-mij__cell-action button').first();
      if (!(await btn.count())) { await closePanel(A.page); return null; }   // nothing offered at all (see STEP4b)
      await btn.click();
      await expect.poll(() => A.page.locator('.cc-mij__share-status').first().textContent(), { timeout: 30_000 }).toMatch(/gedeeld|shared|fout|failed/i);
      const status = (await A.page.locator('.cc-mij__share-status').first().textContent())?.trim();
      await closePanel(A.page);   // the persona panel is an overlay — the tab bar is under it
      return status;
    };
    const shared = await pressShare();
    log('STEP4 share pressed', 'INFO', shared ?? '');
    const bHasIt = await until(async () => {
      const row = (await rosterOf(B.page, gid)).find((m) => m.webid === aWho.webid);
      return row?.personaProperties?.place === 'Groningen' ? row : null;
    }, { timeout: 60_000 });
    expect(bHasIt, "B's roster row for A carries the disclosed property").toBeTruthy();
    log('STEP4 share to this circle', 'PASS', "landed on the co-member's roster row");
    // …and TAKING IT BACK (L115). Until 2026-09-23 unticking the last disclosed property collapsed the circle's
    // row to "nothing shared" with no button, so the withdrawal could never be pushed and the co-member kept the
    // old value. The row carries the action now — an empty release is a real statement the lane carries as a clear.
    await call(A.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: gid, key: 'place', enabled: false });
    const pressed = await pressShare();
    expect(pressed, 'a circle that still holds something offers "stop sharing"').toBeTruthy();
    const withdrawn = await until(async () => {
      const row = (await rosterOf(B.page, gid)).find((m) => m.webid === aWho.webid);
      return row && !row.personaProperties?.place ? true : null;
    }, { timeout: 60_000 });
    expect(withdrawn, "the withdrawal landed on the co-member's row").toBe(true);
    log('STEP4b taking a disclosure back', 'PASS', `status: ${pressed}`);

    // ── (1) + (2) THE LEAVE: A leaves; B is told; A's second device leaves too ─────────────────────
    await closePanel(A.page);
    await gotoCircles(A.page);
    const tile = A.page.locator('.circle-tile', { hasText: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    expect(await tile.count(), 'the tile is there to leave').toBe(1);
    A.page.once('dialog', (d) => d.accept());
    await tile.click({ button: 'right' });
    await A.page.locator('.circle-launcher__tile-menu-item[data-action="leave"]').click();
    await expect.poll(async () => ((await myCircles(A.page)).includes(gid) ? 'still' : 'gone'), { timeout: 60_000 }).toBe('gone');
    const bTold = await until(async () => ((await rosterOf(B.page, gid)).some((m) => m.webid === aWho.webid) ? null : true), { timeout: 90_000 });
    expect(bTold, "B's roster no longer names A — the leave TRAVELLED").toBe(true);
    log('STEP5 a leave travels', 'PASS', "B's roster lost A");
    const a2Followed = await until(async () => ((await myCircles(A2.page)).includes(gid) ? null : true), { timeout: 90_000 });
    expect(a2Followed, "A's second device left the circle too — the leave FOLLOWED").toBe(true);
    log('STEP6 a leave follows', 'PASS', "A's other device left it too");
  } finally {
    for (const p of [A, B, A2]) { try { await p?.ctx?.close(); } catch { /* */ } }
  }
});
