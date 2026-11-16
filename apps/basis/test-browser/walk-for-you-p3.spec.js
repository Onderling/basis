/**
 * "Nieuw voor jou", the rows that are not posts or lines, two real apps over the relay:
 *   1. A (admin) changes a circle setting: B gets "Een beheerder veranderde <circle>: …".
 *   2. A gives B a task: B gets "Een taak in <circle> is nu van jou"; A renaming it afterwards adds nothing.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-for-you-p3.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, gotoCircles } from './peerHarness.js';

test.setTimeout(300_000);
const RE = /drie.?kring/i;
const call = (page, app, opId, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const surface = (page) => page.evaluate(() => window.onderlingSurface?.([]));

async function forYou(page) {
  if (!(await page.locator('[data-tab="screens"]').count())) await gotoCircles(page);
  await page.locator('[data-tab="screens"]').first().click();
  await page.waitForTimeout(1200);
  return page.locator('.circle-screen__block[data-block-type="forYou"] .circle-screen__for-you-row')
    .evaluateAll((els) => els.map((e) => `${e.dataset.kind}|${e.textContent.replace(/\s+/g, ' ').trim()}`));
}

test('a setting someone else changed, and a task given to me, are rows; a rename is not', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const p = await pair(A, B, { name: 'Drie Kring', re: RE });
    expect(p.joined, 'B joined').toBe(true);
    const gid = (await surface(A.page))?.where?.circleId ?? null;
    expect(gid).toBeTruthy();

    // 1 · A changes a setting and states it on the lane, as a settings save does
    const before = await A.page.evaluate((cid) => window.onderlingCirclePolicy.get(cid), gid);
    const on = Boolean(before?.features?.tasks);
    await A.page.evaluate(async ([cid, flip]) => {
      const cur = await window.onderlingCirclePolicy.get(cid);
      await window.onderlingCirclePolicy.update(cid, { features: { ...(cur?.features ?? {}), tasks: flip } });
      await window.onderlingCirclePolicy.state(cid);
    }, [gid, !on]);
    await expect.poll(() => forYou(B.page), { timeout: 90_000, message: 'B: a setting row' }).toContainEqual(expect.stringMatching(/^setting\|/));

    // 2 · A gives B a task; then renames it
    const members = (await call(A.page, 'pinboard', 'listGroupMembers', { groupId: gid }))?.members ?? [];
    const aSelf = (await call(A.page, 'pinboard', 'whoAmI', {}))?.webid ?? null;
    const bRef = members.map((m) => m?.webid).find((w) => w && w !== aSelf) ?? null;
    expect(bRef, JSON.stringify(members)).toBeTruthy();
    const added = await call(A.page, 'tasks', 'addTask', { text: 'ladder terugbrengen', circleId: gid });
    const taskId = added?.id ?? added?.itemId ?? added?.task?.id ?? null;
    expect(taskId, JSON.stringify(added)).toBeTruthy();
    const moved = await call(A.page, 'tasks', 'reassignTask', { id: taskId, newAssignee: bRef, circleId: gid });
    expect(moved?.ok, JSON.stringify(moved)).not.toBe(false);
    await expect.poll(() => forYou(B.page), { timeout: 90_000, message: 'B: a task given to me' }).toContainEqual(expect.stringMatching(/^assigned\|/));
    await B.page.screenshot({ path: 'test-results/for-you-p3.png' });
    const count = (await forYou(B.page)).filter((r) => r.startsWith('assigned|')).length;
    await call(A.page, 'tasks', 'editTask', { id: taskId, text: 'ladder terugbrengen vandaag', circleId: gid });
    await B.page.waitForTimeout(15_000);
    expect((await forYou(B.page)).filter((r) => r.startsWith('assigned|')).length, 'a rename adds no row').toBe(count);
  } finally {
    await teardown(peers);
  }
});
