/**
 * TODAY'S TASK ROW AT PHONE WIDTH (390 px), with a long circle name. Found on a phone (2026-11-18): the circle's tag sat
 * beside the task and took the row's width, so the task wrapped one word per line. The tag goes on its own line above
 * the task, and the task gets the row's full width.
 *
 *   PEER_TEST_PORT=5287 npx playwright test --project=no-relay test-browser/today-task-row-narrow.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('a task in a circle with a long name: the tag above, the task across the row', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 });
  const r = await page.evaluate(async () => {
    const gid = 'lange-naam-today';
    const g = await window.onderlingCall('pinboard', 'createGroupV2', { groupId: gid, name: 'Bewonersvereniging Akkerstraat en omstreken', rules: { text: 't' } });
    const t = await window.onderlingCall('tasks', 'addTask', { text: 'sokken stoppen voor de hele familie', circleId: gid });
    const id = t?.itemId ?? t?.task?.id ?? t?.id;
    const c = id ? await window.onderlingCall('tasks', 'claimTask', { id, circleId: gid }) : null;   // mine: Today shows it
    return { g: g?.groupId ?? g, t: !!id, c: c?.ok ?? !!c };
  });
  expect(r.g, JSON.stringify(r)).toBe('lange-naam-today');
  const row = page.locator('.circle-screen__tasks-row', { hasText: 'sokken stoppen' }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const box = async (sel) => row.locator(sel).first().boundingBox();
  const [rowBox, tag, text] = [await row.boundingBox(), await box('.circle-screen__tasks-circle'), await box('.circle-screen__tasks-text')];
  await page.screenshot({ path: info.outputPath('today-task-row-390.png'), fullPage: true });
  expect(tag, 'the row carries its circle\'s tag').toBeTruthy();
  expect(text.y, 'the task starts below the tag').toBeGreaterThanOrEqual(tag.y + tag.height - 1);
  expect(text.x - rowBox.x, 'the task starts at the row\'s left edge, not in a column beside the tag').toBeLessThan(tag.x - rowBox.x + 4);
});
