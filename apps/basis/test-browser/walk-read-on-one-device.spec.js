/**
 * READ ON ONE DEVICE = READ ON ALL, on real browser bytes. One person on two web apps (A1, and A2 enrolled from it by
 * the add-a-device ceremony) and a circle member B, over a local relay. B writes in the circle: it is news on both of
 * A's devices. A opens the circle on A1 only; A2, untouched, stops counting it once A1's read marks arrive.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-read-on-one-device.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, pair, openCircleMatching, toChat, sendChat, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const RE = /lees.?kring/i;
const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const myCircles = async (page) => ((await call(page, 'pinboard', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);

async function todayNews(page) {
  if (!(await page.locator('[data-tab="screens"]').count())) await gotoCircles(page);   // out of a circle: the tab bar is back
  await page.locator('[data-tab="screens"]').first().click();
  const block = page.locator('.circle-screen__block[data-block-type="circlesUnread"]');
  await expect(block.first()).toBeVisible({ timeout: 15_000 });
  return (await block.first().innerText()).replace(/\s+/g, ' ').trim();
}

test('a line read on one of the person\'s devices is no longer news on the other', async ({ browser }) => {
  test.setTimeout(600_000);
  let A1 = null; let A2 = null; let B = null;
  try {
    A1 = await bootPeer(browser, 'A1');
    B = await bootPeer(browser, 'B');
    const p = await pair(A1, B, { name: 'Lees Kring', re: RE });
    expect(p.joined, 'B joined A\'s circle').toBe(true);
    const circle = (await myCircles(A1.page)).find((id) => !String(id).startsWith('pair-') && !String(id).startsWith('help'));

    // the second device: the same person, added from the first
    A2 = await bootPeer(browser, 'A2');
    A2.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(A2.page);
    const offer = await call(A1.page, 'household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await call(A1.page, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
    const enrolled = await A2.page.evaluate(async ([uri, words]) => {
      localStorage.setItem('onderling.enrollOffer', uri);
      return window.onderlingCall('household', 'enrollDevice', { mnemonic: words, label: 'walk-read-marks' });
    }, [offer.uri, phrase]);
    expect(enrolled?.ok, JSON.stringify(enrolled)).toBe(true);
    await A2.page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => A2.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await myCircles(A2.page)).includes(circle), { timeout: 90_000, message: 'A2 is in the circle' }).toBe(true);
    log('SETUP A2 enrolled', 'PASS', String(circle).slice(0, 10));

    // B writes while neither of A's devices is in the circle: news on both
    await gotoCircles(A1.page);
    await gotoCircles(A2.page);
    await gotoCircles(B.page);
    await openCircleMatching(B.page, RE);
    await toChat(B.page);
    await sendChat(B.page, 'gelezen op één apparaat');
    await expect.poll(() => todayNews(A1.page), { timeout: 60_000, message: 'news on A1' }).toMatch(/💬\s*1 nieuw/);
    await expect.poll(() => todayNews(A2.page), { timeout: 60_000, message: 'news on A2' }).toMatch(/💬\s*1 nieuw/);

    // A reads it on A1 only
    await gotoCircles(A1.page);
    await openCircleMatching(A1.page, RE);
    await A1.page.waitForTimeout(2000);
    await gotoCircles(A1.page);
    await expect.poll(() => todayNews(A1.page), { timeout: 30_000, message: 'read on A1' }).toMatch(/Niets nieuws/);
    log('STEP read on A1', 'PASS', '');

    // A2, untouched, follows
    await expect.poll(() => todayNews(A2.page), { timeout: 90_000, message: 'read on A1 is read on A2' }).toMatch(/Niets nieuws/);
    log('STEP A2 follows', 'PASS', '');
  } finally {
    await teardown([A1, A2, B].filter(Boolean));
  }
});
