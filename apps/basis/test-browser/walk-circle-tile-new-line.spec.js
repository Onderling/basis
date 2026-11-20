/**
 * THE CIRCLES LIST SHOWS A LINE THAT ARRIVES WHILE IT IS ON SCREEN (ledger: the upgrade walk of 2026-11-20 saw the
 * phone's list keep the old preview and the old count while the conversation held the new line).
 *
 * Two real web apps in one circle. A stays on the circles list; B writes. A's tile must show B's line and an unread
 * count without A doing anything. The probe names its branch when it does not: the line has not ARRIVED on A (it is
 * not in the circle when opened) or it arrived and the list did not REPAINT (it shows after leaving and coming back).
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, gotoCircles, openCircleMatching, toChat, sendChat, readBubbles } from './peerHarness.js';

test.setTimeout(300_000);
const NAME = 'Tegel Kring';
const RE = /tegel.?kring/i;
const LINE = 'een nieuwe regel terwijl de lijst open staat';

async function tileText(page) {
  const tiles = page.locator('.circle-tile');
  for (let i = 0; i < await tiles.count(); i += 1) {
    const s = (await tiles.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    if (RE.test(s)) return s;
  }
  return null;
}

test('a line that arrives while the circles list is open shows on its tile', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  try {
    const [A, B] = peers;
    const p = await pair(A, B, { name: NAME, re: RE, handle: 'tegelbee' });
    expect(p.joined, `B joined (${p.outcome})`).toBe(true);
    await gotoCircles(A.page);
    const before = await tileText(A.page);
    expect(before, 'A sees the circle tile').not.toBeNull();

    await openCircleMatching(B.page, RE);
    await toChat(B.page);
    await sendChat(B.page, LINE);

    // A does nothing: the tile must show the line by itself
    let shown = null;
    for (let i = 0; i < 16 && !shown; i += 1) {
      await A.page.waitForTimeout(1000);
      const s = await tileText(A.page);
      if (s && s.includes(LINE)) shown = s;
    }
    if (!shown) {
      // name the branch: leave and come back (a repaint), then open the circle (did it arrive at all?)
      await A.page.locator('[data-tab="screens"]').first().click().catch(() => {});
      await A.page.waitForTimeout(1200);
      await gotoCircles(A.page);
      const afterRepaint = await tileText(A.page);
      await openCircleMatching(A.page, RE);
      const arrived = (await readBubbles(A.page)).some((b) => String(b).includes(LINE));
      throw new Error(`A's tile did not show the line by itself. Before: ${before} | after leaving and coming back: ${afterRepaint} | the line is in the circle: ${arrived} → ${arrived ? (afterRepaint?.includes(LINE) ? 'ARRIVED, NOT REPAINTED' : 'ARRIVED, the tile does not show it even after a repaint') : 'NOT ARRIVED'}`);
    }
    expect(shown).toContain(LINE);
  } finally {
    await teardown(peers);
  }
});
