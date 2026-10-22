/**
 * Who offers what I asked — two real apps over the relay.
 *
 * Bram offers "boormachine uitlenen" and RELEASES it to the circle (the per-circle disclosure, said on the circle's
 * lane). Anna asks the noticeboard for a boormachine. Under her OWN ask she sees Bram, with Ask and Skip; Bram, on his
 * board, sees no matches under her ask. Ask opens the contact thread with Bram; Skip hides him on Anna's device only.
 * Then the ask goes the whole way: Bram answers on the board, Anna accepts him, and it leaves the open board.
 * A second offering Bram keeps to himself is matched by nobody.
 *
 * The offering is set through `agents:setProfileDriver` until the offerings editor exists.
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, toChat, openCircleMatching, gotoCircles } from './peerHarness.js';

test.setTimeout(300_000);

const surface = (page) => page.evaluate(() => window.onderlingSurface?.([]));
const call = (page, app, opId, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;

async function openBoard(page) {
  await toChat(page);
  const tab = page.locator('.circle-view__tab[data-tab="noticeboard"]');
  if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(2000); }
}

test('an ask shows the asker who offers it — released offerings only, nobody else sees the matches', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const p = await pair(A, B, { name: 'Vraag Kring', re: /vraag.?kring/i });
    expect(p.joined, 'the second person joined the circle').toBe(true);
    await openCircleMatching(B.page, /vraag.?kring/i);
    const gid = await activeCircle(A.page);
    expect(await activeCircle(B.page)).toBe(gid);

    // Bram offers two things; he releases ONE to this circle.
    for (const [key, text] of [['boor', 'boormachine uitlenen'], ['ladder', 'ladder en boormachine bits']]) {
      expect(await call(B.page, 'agents', 'setProfileDriver', { id: 'default', key, kind: 'offering', text, tags: '' })).toMatchObject({ ok: true });
    }
    expect(await call(B.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: gid, key: 'boor', enabled: true })).toMatchObject({ ok: true });
    const said = await B.page.evaluate((cid) => window.onderlingShareToCircle?.(cid, 'default') ?? { error: 'no-seam' }, gid);
    expect(said, JSON.stringify(said)).toMatchObject({ ok: true });

    // Anna asks, from the board's own composer.
    await openBoard(A.page);
    await A.page.locator('.cc-noticeboard__input, .cc-noticeboard textarea, .cc-noticeboard input[type="text"]').first().fill('Heeft iemand een boormachine?');
    await A.page.locator('.cc-noticeboard__post, .cc-noticeboard button[data-action="post"]').first().click();

    // Under her own ask: Bram, with the offering he released — and only that one.
    const matches = A.page.locator('.cc-noticeboard__matches .circle-offering-matches__row');
    await expect.poll(async () => {
      await openBoard(A.page);
      return matches.count();
    }, { timeout: 60_000, message: "Bram's released offering reaches Anna's roster and matches her ask" }).toBeGreaterThan(0);
    await expect(A.page.locator('.cc-noticeboard__matches .circle-offering-matches__offering')).toHaveText(['boormachine uitlenen']);
    await expect(A.page.locator('.cc-noticeboard__matches')).not.toContainText('bits');

    // Bram reads the ask — its WORDS, so a post sealed under a key he was never given shows up here as the sealed
    // envelope it is — and no matches under it: they are the asker's.
    await expect.poll(async () => { await openBoard(B.page); return B.page.evaluate(() => document.body.innerText); },
      { timeout: 60_000, message: "Anna's ask reaches Bram's board, readable" }).toMatch(/boormachine\?/i);
    expect(await B.page.locator('.cc-noticeboard__matches').count()).toBe(0);

    // Ask: the contact thread with Bram opens (nothing is sent until Anna writes).
    await A.page.locator('.cc-noticeboard__matches .circle-offering-matches__ask').first().click();
    await expect(A.page.locator('.cc-cthread__log')).toBeVisible({ timeout: 15_000 });
    await gotoCircles(A.page);
    await openCircleMatching(A.page, /vraag.?kring/i);
    await openBoard(A.page);
    await expect(matches).toHaveCount(1, { timeout: 15_000 });

    // Skip: gone on Anna's board, and it stays gone after a reload of the board.
    await A.page.locator('.cc-noticeboard__matches .circle-offering-matches__skip').first().click();
    await A.page.waitForTimeout(1500);
    await openBoard(A.page);
    expect(await A.page.locator('.cc-noticeboard__matches').count()).toBe(0);

    // …and the ask goes the whole way: Bram answers it on his board, Anna accepts him on her post, and the accepted
    // ask is off the open board (story 4's path, now after a match).
    await openBoard(A.page);   // Anna watches her board from here on: nothing below re-opens it
    await openBoard(B.page);
    const respond = B.page.locator('.cc-noticeboard__chip[data-action="respond"]').first();
    await expect(respond).toBeVisible({ timeout: 30_000 });
    B.page.once('dialog', (d) => d.accept('Ja, ik heb er een — kom maar langs.'));
    await respond.click();
    // the answer arriving re-reads the open board (no polling, no re-entry)
    const accept = A.page.locator('.cc-noticeboard__chip[data-action="accept"]');
    await expect(accept, "Bram's answer reaches Anna's open board as an Accept").toHaveCount(1, { timeout: 60_000 });
    await accept.first().click();
    // a tap on the tab the board is already on re-reads it
    const boardTab = A.page.locator('.circle-view__tab[data-tab="noticeboard"]').first();
    await expect.poll(async () => { await boardTab.click(); await A.page.waitForTimeout(1000); return A.page.evaluate(() => document.querySelector('.cc-noticeboard')?.innerText ?? ''); },
      { timeout: 30_000, message: 'the accepted ask is off the open board' }).not.toMatch(/boormachine\?/i);
  } finally { await teardown(peers); }
});
