/**
 * THE "+" OF A MEMBER WHO JOINED. The phone walk (e2e/plusCircleAct) found the "+" answering "I could not read that."
 * to "zet melk op de boodschappen" for a person who JOINED a circle whose lists came on by the founder's setting, while
 * the founder's own "+" (plus-circle-act.spec) runs it. This is the joiner's case on two browsers over a relay: A founds
 * the circle, switches lists on and makes Boodschappen; B joins; B's "+" reads the line, runs it in that circle, and
 * A's own Boodschappen holds melk.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-plus-joiner.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, openMore, openCircleMatching, log } from './peerHarness.js';
import { circleIds } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_PORT + PEER_TEST_RELAY');

const inCircle = async (page) => { if (!(await page.locator('.circle-view__more').count())) await openCircleMatching(page, /plus samen/i); };

test("a member who joined: the '+' runs \"zet melk op de boodschappen\" in the circle that holds the list", async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Plus Samen', re: /plus samen/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));

    // A, the founder: lists on (the admin's setting, stated on the lane) and a Boodschappen list
    await inCircle(A.page);
    expect(await openMore(A.page, 'settings')).toBe(true);
    const box = A.page.locator('input[data-feature="lists"]');
    await expect(box).toBeVisible({ timeout: 20_000 });
    if (!(await box.isChecked())) await box.check();
    await A.page.locator('.circle-settings__save').click();
    await A.page.waitForTimeout(800);
    const made = await A.page.evaluate((cid) => window.onderlingCall('lists', 'createList', { circleId: cid, text: 'Boodschappen' }), circle);
    expect(made?.ok, JSON.stringify(made)).not.toBe(false);
    log('STEP1 the founder has lists on and Boodschappen', 'PASS', '');

    // B, the joiner: the policy and the list reach B's device (read through B's own ops, the '+' reads the same)
    await expect.poll(async () => B.page.evaluate(async (cid) => {
      const p = await window.onderlingCirclePolicy?.get(cid).catch(() => null);
      const ls = await window.onderlingCall('lists', 'listLists', { circleId: cid }).catch(() => null);
      return JSON.stringify({ lists: p?.features?.lists === true, names: (ls?.lists ?? ls?.items ?? []).map((l) => l?.name ?? l?.text ?? l) });
    }, circle), { timeout: 120_000, intervals: [3_000], message: 'the policy and the list reach the member' }).toMatch(/"lists":true.*Boodschappen/);
    log('STEP2 the member holds lists on and Boodschappen', 'PASS', '');

    // B's '+': the line runs in that circle
    for (const sel of ['.circle-settings__back', '.circle-view__back']) {
      const b = B.page.locator(sel);
      if (await b.count()) { await b.first().click(); await B.page.waitForTimeout(800); }
    }
    await B.page.locator('[data-tab="screens"]').first().click();
    await expect(B.page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
    await B.page.locator('.circle-vandaag__plus').click();
    await B.page.locator('.circle-vandaag-plus__line').fill('zet melk op de boodschappen');
    await B.page.locator('.circle-vandaag-plus__line').press('Enter');
    await expect(B.page.locator('.circle-vandaag-plus__done'), "the member's '+' says what it did").toBeVisible({ timeout: 20_000 });
    log('STEP3 the member\'s "+" ran it', 'PASS', '');
    // the kept conversation shows both voices: the person's own line and what the '+' answered
    await expect(B.page.locator('.circle-vandaag-plus__turn--you', { hasText: 'zet melk op de boodschappen' }), "the member's own line is kept and shown").toBeVisible({ timeout: 10_000 });

    // …and it is on the founder's own list
    await expect.poll(async () => A.page.evaluate(async (cid) => ((await window.onderlingCall('lists', 'listEntries', { circleId: cid, list: 'Boodschappen' }))?.items ?? []).map((e) => e.label), circle),
      { timeout: 120_000, intervals: [3_000] }).toContain('melk');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
