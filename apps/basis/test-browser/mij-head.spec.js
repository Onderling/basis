/**
 * MIJ READS NOTHING WHEN NOTHING CHANGED (2026-10-31). On a phone each landing on Mij read the circles' rosters ×4, the
 * open tasks ×3 and the profile's facts, ending at ~5 s. Mij is now a head kept current by the circles' changes, the
 * event log and the agent registry (a profile's facts are the registry's): a landing on a fresh head reads nothing, and
 * a profile fact changed while Mij is shown is read again without leaving the tab.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/mij-head.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

const reads = (page) => page.evaluate(() => ({ ...window.onderlingMijReads }));

test('a second Mij landing reads nothing; a registry change while shown is read again', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000);   // boot settles (a fresh profile seeds its own lists a few seconds in)
  for (let i = 0; i < 2; i += 1) {   // one round trip to settle, then the measured one
    await page.locator('[data-tab="mij"]').first().click();
    await page.waitForTimeout(2500);
    await page.locator('[data-tab="circles"]').first().click();
    await page.waitForTimeout(1500);
  }
  const before = await reads(page);
  expect(before.landings, 'the counters are there').toBeGreaterThan(0);
  await page.locator('[data-tab="mij"]').first().click();
  await page.waitForTimeout(2500);
  const after = await reads(page);
  expect(after.landings, 'one more landing').toBe(before.landings + 1);
  expect(after.materializes - before.materializes, 'the landing read nothing').toBe(0);
  expect(after.ops - before.ops, 'the landing made no op call').toBe(0);

  // a profile fact changes while Mij is shown (the registry, no circle's item): Mij reads again, by itself
  await page.evaluate(() => window.onderlingCall('agents', 'setProfileProperty', { id: 'default', key: 'woont', value: 'hier' }));
  await page.waitForTimeout(2500);
  const changed = await reads(page);
  expect(changed.materializes - after.materializes, 'the registry change was heard').toBeGreaterThanOrEqual(1);
  expect(errs).toEqual([]);
});
