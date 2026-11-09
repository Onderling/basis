/**
 * Today's circles with news, two real apps over the relay. B makes a circle, A joins. Today never goes empty without
 * naming what it looked at; then everything B adds is news on A's Today, by kind: a chat line, a noticeboard post, a
 * post that arrives while A was offline (the catch-up), and an appointment. The circle tile never paints a system row
 * (a circle id, a sealed envelope).
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-today-news.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, toChat, gotoCircles, openCircleMatching, sendChat } from './peerHarness.js';

test.setTimeout(300_000);

const RE = /nieuws.?kring/i;

/** The circles-with-news block on Today, as text. */
async function todayNews(page) {
  await page.locator('[data-tab="screens"]').first().click();
  const block = page.locator('.circle-screen__block[data-block-type="circlesUnread"]');
  await expect(block.first()).toBeVisible({ timeout: 15_000 });
  return (await block.first().innerText()).replace(/\s+/g, ' ').trim();
}

async function tileText(page) {
  await gotoCircles(page);
  return (await page.locator('.circle-tile', { hasText: /Nieuws Kring/ }).first().innerText()).replace(/\s+/g, ' ').trim();
}

async function postOnBoard(page, text) {
  await page.locator('.circle-view__tab[data-tab="noticeboard"]').first().click();
  const input = page.locator('.cc-noticeboard__input, .cc-noticeboard textarea, .cc-noticeboard input[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await input.fill(text);
  await page.locator('.cc-noticeboard__post, .cc-noticeboard button[data-action="post"]').first().click();
  // the writer's own board shows it: the post was made (a failure here is the writer's, not the news)
  await expect(page.locator('.cc-noticeboard')).toContainText(text, { timeout: 15_000 });
}

test('everything someone else adds is news on Today, by kind; an empty Today names its circle', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const p = await pair(B, A, { name: 'Nieuws Kring', re: RE });
    expect(p.joined, 'A joined B\'s circle').toBe(true);
    expect(await todayNews(A.page), 'nothing new yet, and it says where it looked').toMatch(/Niets nieuws in Nieuws Kring/);

    await gotoCircles(B.page);
    await openCircleMatching(B.page, RE);
    await toChat(B.page);
    await sendChat(B.page, 'hallo van B');
    await expect.poll(() => todayNews(A.page), { timeout: 60_000, message: 'a chat line is news' }).toMatch(/Nieuws Kring\s*💬\s*1 nieuw/);

    await postOnBoard(B.page, 'Wie heeft een ladder?');
    await expect.poll(() => todayNews(A.page), { timeout: 60_000, message: 'a board post is news, as an ask' }).toMatch(/🙋.*2 nieuw/);
    const tile = await tileText(A.page);
    expect(tile, 'the tile paints no system row').not.toMatch(/fp1:|📥|[0-9a-f]{24}/);

    // the catch-up: A is offline while B posts
    await A.page.context().setOffline(true);
    await postOnBoard(B.page, 'Wie heeft een boor?');
    await B.page.waitForTimeout(5000);
    await A.page.context().setOffline(false);
    await expect.poll(() => todayNews(A.page), { timeout: 90_000, message: 'a post that came while A was offline is news' }).toMatch(/3 nieuw/);

    // an appointment in the circle (the walk's row 60)
    const gid = (await B.page.evaluate(() => window.onderlingSurface?.([])))?.where?.circleId ?? null;
    const appt = await B.page.evaluate((cid) => window.onderlingCall('calendar', 'addEvent', { circleId: cid, title: 'koffie met A', when: new Date(Date.now() + 86_400_000).toISOString() }), gid);
    expect(appt?.ok, JSON.stringify(appt)).toBe(true);
    await expect.poll(() => todayNews(A.page), { timeout: 60_000, message: 'an appointment is news' }).toMatch(/📅.*4 nieuw/);
  } finally {
    await teardown(peers);
  }
});
