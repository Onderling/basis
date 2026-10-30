/**
 * VANDAAG READS NOTHING WHEN NOTHING CHANGED (2026-10-30). On a phone each landing on Vandaag ran calendar.listEvents ×6
 * and tasks.listOpen ×3. Vandaag is now a head kept current by the circles' changes: a landing on a fresh head
 * materializes nothing, and a change while it is shown is one read, not one per item.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag-head.spec.js
 */
import { test, expect } from '@playwright/test';
import { createCircle } from './peerHarness.js';

test.setTimeout(120_000);

const reads = (page) => page.evaluate(() => ({ ...window.onderlingVandaagReads }));

test('a second landing reads nothing; a change while shown is one read', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000);   // boot settles (its own catch-ups may refold once)
  // one round trip first: a fresh profile seeds its own lists shortly after boot (a write Vandaag does show)
  await page.locator('[data-tab="circles"]').first().click();
  await page.waitForTimeout(1500);
  await page.locator('[data-tab="screens"]').first().click();
  await page.waitForTimeout(3000);
  const before = await reads(page);
  expect(before.landings, 'the counters are there').toBeGreaterThan(0);

  await page.locator('[data-tab="circles"]').first().click();
  await page.waitForTimeout(1500);
  await page.locator('[data-tab="screens"]').first().click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const after = await reads(page);
  expect(after.landings, 'one more landing').toBe(before.landings + 1);
  expect(after.materializes - before.materializes, 'the landing materialized nothing').toBe(0);
  expect(after.ops - before.ops, 'the landing made no op call').toBe(0);

  // a change while Vandaag is shown: a list made in a circle (a write the head hears) → one read, after the wait
  await createCircle(page, 'Kopkring');
  await page.locator('[data-tab="screens"]').first().click();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000);
  const shown = await reads(page);
  const circleId = ((await page.evaluate(() => window.onderlingCall('pinboard', 'listMyCircles', {})))?.circles ?? []).find((c) => c !== 'cc-help');
  expect(circleId, 'the circle exists').toBeTruthy();
  await page.evaluate(async (cid) => {
    await window.onderlingCall('lists', 'createList', { text: 'Kopjes', circleId: cid });
    await window.onderlingCall('lists', 'createList', { text: 'Schotels', circleId: cid });
  }, circleId);
  await page.waitForTimeout(3000);
  const changed = await reads(page);
  test.info().annotations.push({ type: 'after-change', description: JSON.stringify(changed) });
  expect(changed.materializes - shown.materializes, 'the burst refolded').toBeGreaterThanOrEqual(1);
  expect(changed.materializes - shown.materializes, 'two writes, one wait: at most two reads').toBeLessThanOrEqual(2);
  expect(errs).toEqual([]);
});
