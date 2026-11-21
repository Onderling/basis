/**
 * A CIRCLE'S CONVERSATION KINDS BIND ON EVERY MEMBER'S DEVICE, NOT ONLY IN THE THREAD.
 *
 * Three real web apps in one circle. A (the admin) switches chat lines off for the circle. B still sends one (a plain
 * chat line is not gated on the sender, and an older app would send it anyway). C must not show it in the thread, count
 * it on the tile, put it in the tile's subtitle, or list it on Today. When A switches chat back on, C shows the line: the
 * kinds are a view filter, nothing was dropped.
 * The probe names its branch: the policy has not reached C (its own settings still show chat on), or it has and a
 * reader still shows the line.
 */
import { test, expect } from '@playwright/test';
import {
  bootPeers, teardown, pair, gotoCircles, openCircleMatching, toChat, sendChat, readBubbles, getInvite, joinFromInvite, openMore,
} from './peerHarness.js';

test.setTimeout(420_000);
const NAME = 'Soort Kring';
const RE = /soort.?kring/i;
const LINE = 'een regel van een soort die uit staat';

async function tileText(page) {
  const tiles = page.locator('.circle-tile');
  for (let i = 0; i < await tiles.count(); i += 1) {
    const s = (await tiles.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    if (RE.test(s)) return s;
  }
  return null;
}

/** ⋯ → settings: set the chat kind on or off and save (the admin's save is a signed policy statement). */
async function setChatKind(page, on) {
  await gotoCircles(page); await openCircleMatching(page, RE);
  if (!(await openMore(page, 'settings'))) return 'no settings item';
  const box = page.locator('input[data-kind="chat-message"]');
  if (!(await box.count())) return 'no chat kind control';
  if ((await box.first().isChecked()) !== on) { if (on) await box.first().check(); else await box.first().uncheck(); }
  const save = page.locator('.circle-settings__save');
  if (!(await save.count()) || !(await save.first().isEnabled())) return 'save not available';
  await save.first().click();
  await page.waitForTimeout(1800);
  return 'saved';
}

/** Does this device's own settings say chat is on? (null: no control seen) */
async function chatKindOn(page) {
  await gotoCircles(page); await openCircleMatching(page, RE);
  if (!(await openMore(page, 'settings'))) return null;
  const box = page.locator('input[data-kind="chat-message"]');
  const on = (await box.count()) ? await box.first().isChecked() : null;
  await gotoCircles(page);
  return on;
}

test('a kind the circle has off is not shown, counted or listed on another member\'s device; on again shows it', async ({ browser }) => {
  const peers = await bootPeers(browser, 3);
  try {
    const [A, B, C] = peers;
    const p = await pair(A, B, { name: NAME, re: RE, handle: 'soortbee' });
    expect(p.joined, `B joined (${p.outcome})`).toBe(true);
    await gotoCircles(A.page); await openCircleMatching(A.page, RE);
    const uri = await getInvite(A.page, 'kinds-c-invite');
    expect(uri, 'A has an invite for C').toBeTruthy();
    const jc = await joinFromInvite(C.page, uri, { handle: 'soortcee', tag: 'kinds-c' });
    expect(jc.joined, `C joined (${jc.outcome})`).toBe(true);

    // B says a line while chat is on; C, on its circles list, sees it arrive (subtitle and count) without opening
    await gotoCircles(B.page); await openCircleMatching(B.page, RE);
    await toChat(B.page);
    await sendChat(B.page, LINE);
    await gotoCircles(C.page);
    let arrived = null;
    for (let i = 0; i < 16 && !arrived; i += 1) { await C.page.waitForTimeout(1000); const s = await tileText(C.page); if (s?.includes(LINE)) arrived = s; }
    expect(arrived, 'the line arrived on C\'s tile while chat was on').toBeTruthy();
    expect(await C.page.locator('.circle-tile').filter({ hasText: RE }).locator('.circle-tile__unread').count(), 'C counts it while chat is on').toBe(1);

    // A switches chat off; C, still on its list and never opening the circle, must stop showing and counting it
    expect(await setChatKind(A.page, false)).toBe('saved');
    await gotoCircles(A.page);
    let tile = arrived;
    for (let i = 0; i < 20 && tile?.includes(LINE); i += 1) {
      await C.page.waitForTimeout(1500);
      // the circles list reloads its circles (and so their kinds) when it is shown again
      await C.page.locator('[data-tab="screens"]').first().click(); await C.page.waitForTimeout(500); await gotoCircles(C.page);
      tile = await tileText(C.page);
    }
    if (tile?.includes(LINE)) {
      throw new Error(`C's tile still shows the line with chat off. C's own settings say chat on: ${await chatKindOn(C.page)} → ${'(true: the policy has not reached C; false: it has, and the tile does not ask the kinds)'}`);
    }
    expect(tile, 'C sees the circle tile').not.toBeNull();
    expect(await C.page.locator('.circle-tile').filter({ hasText: RE }).locator('.circle-tile__unread').count(),
      `no unread count on C's tile (tile: ${tile})`).toBe(0);
    await C.page.locator('[data-tab="screens"]').first().click();
    await C.page.waitForTimeout(1500);
    const today = (await C.page.locator('body').innerText()).replace(/\s+/g, ' ');
    expect(today, 'Today does not list the hidden line').not.toContain(LINE);
    await gotoCircles(C.page); await openCircleMatching(C.page, RE);
    expect((await readBubbles(C.page)).some((b) => String(b).includes(LINE)), 'the thread does not show the hidden line').toBe(false);
    await gotoCircles(C.page);

    // on again: the line comes back (nothing was dropped)
    expect(await setChatKind(A.page, true)).toBe('saved');
    let back = false;
    for (let i = 0; i < 10 && !back; i += 1) {
      await C.page.waitForTimeout(2000);
      await gotoCircles(C.page); await openCircleMatching(C.page, RE);
      back = (await readBubbles(C.page)).some((b) => String(b).includes(LINE));
      await gotoCircles(C.page);
    }
    expect(back, `C shows the line once chat is on again (C's settings say chat on: ${await chatKindOn(C.page)})`).toBe(true);
  } finally {
    await teardown(peers);
  }
});
