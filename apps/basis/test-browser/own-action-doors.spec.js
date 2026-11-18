/**
 * THE DOORS NAME THEMSELVES — the person's own record (ownActions.js, ledger L203) in the real web app.
 *
 * A read is recorded only when a door says the person asked for it; the door is named where it is known: the shared
 * turn engine (slash, phrase, model) and the act strip's wrapper (tap). This walks the slash door end to end, through
 * the shell's dispatch, which once dropped the call's context, and once read a name the reply painter also declares.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/own-action-doors.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle, sendCircle } from './helpers.js';

const rows = (page) => page.evaluate(() => (typeof window.onderlingOwnActions === 'function' ? window.onderlingOwnActions() : null));

test('a /lists typed in a circle is one own act, door slash, outcome ok; nothing is recorded with door unknown for it', async ({ page }) => {
  test.setTimeout(120_000);
  await bootCircle(page, 'Doors Circle');
  const before = await rows(page);
  expect(before, 'the page exposes the record (window.onderlingOwnActions)').not.toBeNull();
  await sendCircle(page, '/lists');
  await expect.poll(async () => ((await rows(page)) ?? []).slice(before.length).map((r) => `${r.app}.${r.op}:${r.door}:${r.outcome}`), { timeout: 10_000 })
    .toEqual(['lists.listLists:slash:ok']);
  const bubbles = await page.locator('.circle-view__bubble').allInnerTexts();
  expect(bubbles.join('\n'), 'the slash ran: no failure bubble').not.toMatch(/didn.t work|ging niet/i);
});

// The interaction window is a guess (actState.js), so its effect is PINNED: what a person's first minutes record, act by
// act, door by door. A background write that starts reading as 'tap' (the key fan-out once did, and read marks) turns
// this red; so does a person's act that stops being recorded. Mark a background op `surfaces.actState: 'none'`.
test('the first minutes, pinned: make a circle, write a line, open its settings, walk the tabs: exactly these acts', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.waitForTimeout(2500);
  const start = (await rows(page)) ?? [];
  await bootCircle(page, 'Pinned Circle');                     // the wizard: make the circle, my handle in it
  await sendCircle(page, 'hallo allemaal');                    // a chat line (its own bubble carries its state)
  await page.locator('.circle-view__more').click();
  await page.locator('.circle-view__more-item[data-action="settings"]').click();   // a read: opening settings
  await page.waitForTimeout(2500);
  for (const tab of ['today', 'circles', 'nearby', 'me']) {
    const el = page.locator(`[data-tab="${tab}"]`);
    if (await el.count()) { await el.first().click(); await page.waitForTimeout(2500); }
  }
  const got = ((await rows(page)) ?? []).slice(start.length).map((r) => `${r.app}.${r.op}:${r.door}:${r.outcome}`);
  expect(got).toEqual([
    'pinboard.createGroupV2:tap:ok',
    'pinboard.setMyHandle:tap:ok',
  ]);
});
