/**
 * ONE PERSON, TWO DEVICES, TWO FIRST STATEMENTS — the case the fork detector must not mistake for a fork.
 *
 * Each device of a person signs its own statements in a circle with its own key and chains them from its OWN head.
 * So the laptop's first `member-props` in a circle and the phone's first one both have no parent. Keyed by PERSON, the
 * fork detector read that as one author equivocating: before its fix it silently discounted both statements, and with
 * "fork onward" (#200) as first written it would have REMOVED the person from the circle on every device. The fold
 * test pins the rule; this is its browser twin, with the acts a tester does on day one.
 *
 * Three web apps over a local relay: A1 (the laptop) founds a circle with C in it; A2 (the phone) is enrolled from
 * A1 and follows into the circle. Then, each device's first word about itself there:
 *   A1  renames under Mij           → a `member-props` naming the display name, on every circle
 *   A2  shares a disclosed place    → a `member-props` carrying the release, on this circle
 * On all three devices: the person is still on the roster, and both changes landed on the row.
 *
 * (The brief says "a face on the phone". A face cannot be shared in a pod-less circle yet — L140 — so the phone
 * shares a place: the same statement kind on the same lane, which is what the fork detector sees.)
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-two-devices-first-statements.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, pair, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const myCircles = async (page) => ((await call(page, 'stoop', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
const roster = async (page, circleId) => (await call(page, 'stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? [];
/** A's row as `page` folds it: present? which name? which released place? */
const aRowOn = async (page, circleId, aId) => {
  const m = (await roster(page, circleId)).find((x) => x.webid === aId);
  if (!m) return { present: false };
  return { present: true, name: m.said?.displayName ?? m.displayName ?? null, place: m.personaProperties?.place ?? m.said?.personaProperties?.place ?? null };
};

async function closePanel(page) {
  const x = page.locator('.cc-screen-panel__close');
  while (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
  await gotoCircles(page);
}

test('a rename on one device and a disclosure on the other, each its first statement in the circle: the person stays, both land', async ({ browser }) => {
  test.setTimeout(600_000);
  let A1 = null; let A2 = null; let C = null;
  try {
    // ── A1 founds a circle with C in it ─────────────────────────────────────────────────────────────
    A1 = await bootPeer(browser, 'A1'); C = await bootPeer(browser, 'C');
    const p = await pair(A1, C, { name: 'Twee toestellen', re: /twee.?toestellen/i, handle: 'cees' });
    expect(p.joined, `C joined: ${p.outcome}`).toBe(true);
    for (const peer of [A1, C]) peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const circle = (await myCircles(A1.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    const aId = (await call(A1.page, 'stoop', 'whoAmI'))?.webid;
    expect(circle, 'the circle').toBeTruthy();

    // ── A2 enrolled from A1, follows into the circle ─────────────────────────────────────────────────
    A2 = await bootPeer(browser, 'A2');
    A2.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(A2.page);
    const offer = await call(A1.page, 'household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await call(A1.page, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
    const enrolled = await A2.page.evaluate(async ([uri, words]) => {
      localStorage.setItem('onderling.enrollOffer', uri);
      return window.onderlingCall('household', 'enrollDevice', { mnemonic: words, label: 'walk-two-devices' });
    }, [offer.uri, phrase]);
    expect(enrolled?.ok, JSON.stringify(enrolled)).toBe(true);
    await A2.page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => A2.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await myCircles(A2.page)).includes(circle), { timeout: 90_000, message: 'A2 is in the circle' }).toBe(true);
    expect((await call(A2.page, 'stoop', 'whoAmI'))?.webid, 'A2 is the same person').toBe(aId);
    log('SETUP A1 + A2 + C in one circle', 'PASS', String(circle).slice(0, 10));

    // ── the two first statements, one per device, close together ─────────────────────────────────────
    const newName = `Anna ${Date.now().toString(36).slice(-4)}`;
    await gotoCircles(A1.page);
    await A1.page.locator('[data-tab="mij"]').first().click(); await A1.page.waitForTimeout(1200);
    await A1.page.locator('.cc-profile__display').fill(newName);
    const renamed = A1.page.locator('.cc-profile__save').click();
    const disclosed = (async () => {
      await call(A2.page, 'agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' });
      await call(A2.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: circle, key: 'place', enabled: true });
      await gotoCircles(A2.page);
      await A2.page.locator('[data-tab="mij"]').first().click(); await A2.page.waitForTimeout(1500);
      await A2.page.locator('.cc-profile__offerings-moved-link').first().click(); await A2.page.waitForTimeout(2000);
      const row = A2.page.locator(`.cc-mij__table tr[data-circle-id="${circle}"]`);
      const btn = row.locator('.cc-mij__cell-action button').first();
      if (!(await btn.count())) return { pressed: false, why: 'no share button on the circle row' };
      await btn.click();
      const status = row.locator('.cc-mij__share-status').first();
      await expect.poll(() => status.textContent(), { timeout: 30_000 }).toMatch(/gedeeld|shared|fout|failed/i);
      const text = (await status.textContent())?.trim();
      await closePanel(A2.page);
      return { pressed: true, status: text };
    })();
    const [, share] = await Promise.all([renamed, disclosed]);
    expect(share.pressed, `A2 shared: ${share.why ?? ''}`).toBe(true);
    log('STEP1 two first statements', 'PASS', `A1 renamed to "${newName}" · A2 shared: ${share.status}`);

    // ── on every device: the person stays, and both changes landed ────────────────────────────────────
    for (const [label, peer] of [['C', C], ['A1', A1], ['A2', A2]]) {
      await expect.poll(async () => {
        const r = await aRowOn(peer.page, circle, aId);
        return r.present ? `${r.name}|${r.place}` : 'GONE';
      }, { timeout: 90_000, message: `${label}: A is on the roster with the new name and the place` }).toBe(`${newName}|Groningen`);
      log(`STEP2 ${label} holds A whole`, 'PASS', '');
    }
    // …and still there a little later: a fork read would drop A on the next fold, not the first
    await A1.page.waitForTimeout(5000);
    for (const [label, peer] of [['C', C], ['A1', A1], ['A2', A2]]) {
      expect((await aRowOn(peer.page, circle, aId)).present, `${label}: A is still on the roster`).toBe(true);
    }
    log('STEP3 A stays', 'PASS', 'every device, after a later fold');
  } finally {
    await teardown([A1, A2, C].filter(Boolean));
  }
});
