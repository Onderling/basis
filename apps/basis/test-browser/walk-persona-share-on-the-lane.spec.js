/**
 * "Share to this circle" says the persona's release on the membership lane (step two of the member-props note,
 * 2026-09-22). Two web apps in one circle: B discloses one property to the circle and presses the button under Mij;
 * A's roster row for B carries it — no admin handled anything (A IS the admin here, and never wrote the roster).
 *
 * Arm with a local relay (the fixture starts it):
 *   PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-persona-share-on-the-lane.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, pair, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('B discloses a property and shares it from Mij; A\'s roster row for B carries it, said on the lane', async ({ browser }) => {
  test.setTimeout(240_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Lane share', re: /lane.?share/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    await B.page.waitForTimeout(3000);
    const bId = (await B.page.evaluate(async () => window.onderlingCall('stoop', 'whoAmI', {})))?.webid;
    const gid = (await A.page.evaluate(async () => ((await window.onderlingCall('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).find((id) => !/^pair-|^cc-help$/.test(String(id)))));
    expect(gid, 'the circle id').toBeTruthy();
    log('STEP1 a circle of two', 'PASS', `${String(gid).slice(0, 12)}…, B = ${String(bId).slice(0, 12)}…`);

    // B sets a property and discloses it to THIS circle (the persona's release for it) — through the waist.
    await B.page.evaluate(async (cid) => {
      await window.onderlingCall('agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' });
      await window.onderlingCall('agents', 'setProfileDisclosure', { id: 'default', contextId: cid, key: 'place', enabled: true });
    }, gid);
    // …and presses the button under Mij: the release goes out as B's own `member-props` on the circle's lane.
    await gotoCircles(B.page);
    await B.page.locator('[data-tab="mij"]').first().click(); await B.page.waitForTimeout(1500);
    // the per-circle disclosure table lives on the persona panel ("Mij → persona's")
    await B.page.locator('.cc-profile__offerings-moved-link').first().click(); await B.page.waitForTimeout(2000);
    const share = B.page.locator('.cc-mij__cell-action button').first();
    if (!(await share.count())) {
      const mij = await B.page.evaluate(() => ({ text: document.body.innerText.slice(0, 1500), buttons: [...document.querySelectorAll('button')].map((b) => `${b.className}:${b.textContent.trim().slice(0, 30)}`).slice(0, 40) }));
      throw new Error(`Mij offers no "Share to this circle" — ${JSON.stringify(mij)}`);
    }
    await share.click();
    await expect.poll(() => B.page.locator('.cc-mij__share-status').first().textContent(), { timeout: 15_000 }).toMatch(/shared|gedeeld/i);
    log('STEP2 B shared from Mij', 'PASS', await B.page.locator('.cc-mij__share-status').first().textContent());

    // A's roster row for B carries the property — folded from B's statement, the admin wrote nothing.
    const rowOnA = async () => A.page.evaluate(async ([cid, who]) => {
      const r = await window.onderlingCall('stoop', 'listGroupMembers', { groupId: cid });
      const m = (r?.members ?? []).find((x) => x.webid === who);
      return m ? { personaProperties: m.personaProperties ?? null, said: m.said ?? null } : null;
    }, [gid, bId]);
    await expect.poll(async () => (await rowOnA())?.personaProperties?.place ?? null, { timeout: 30_000 }).toBe('Groningen');
    const row = await rowOnA();
    expect(row.said?.personaProperties, 'the row says the lane holds it').toEqual({ place: 'Groningen' });
    log('STEP3 A\'s row carries it', 'PASS', JSON.stringify(row));
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
