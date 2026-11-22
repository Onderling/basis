/**
 * THE RECORD OF WHAT YOU DO, UNDER MIJN GEGEVENS (ledger L203 PR 3). One row: what it keeps and where, its switch, how
 * much is kept now, a file to save, and the wipe (two taps; this kind only). Switched off, nothing new is kept.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/own-actions-mydata.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

const openMyData = async (page) => {
  await page.locator('.cc-persona-button__settings').click();
  await page.locator('.cc-settings__group--my-data').click();
};
const rows = (page) => page.evaluate(() => window.onderlingOwnActions?.() ?? null);

test('the row says what it keeps, exports a file with no words, wipes this kind only, and off keeps nothing new', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  // an act the person took, so there is something kept: a list made in the "+" (a call no door names is background)
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').dblclick();
  await page.locator('.circle-vandaag-plus__line').fill('nieuwe lijst klusjes');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect.poll(async () => ((await rows(page)) ?? []).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3000);   // the log persists after the act; a reload at once would race it (any entry would)
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await openMyData(page);
  const sec = page.locator('[data-section="own-actions"]');
  await expect(sec).toBeVisible({ timeout: 15_000 });
  await expect(sec, 'what it keeps and where').toContainText(/Alleen op dit apparaat|On this device only/);
  const n = (await rows(page)).length;
  expect(n, 'the list made in the "+" is kept').toBeGreaterThan(0);
  await expect(sec.locator('.cc-mydata__own-actions-count')).toContainText(String(n));

  // export: one file, the rows, never the words
  const [download] = await Promise.all([page.waitForEvent('download'), sec.locator('.cc-mydata__own-actions-export').click()]);
  const file = JSON.parse(await (await download.createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8')));
  expect(file.format).toBe('onderling-own-actions');
  expect(file.rows.length).toBeGreaterThanOrEqual(n);
  expect(JSON.stringify(file), 'never the words').not.toMatch(/klusjes/);

  // wipe: two taps; the record is empty after, nothing else went
  const wipe = sec.locator('.cc-mydata__own-actions-wipe');
  await wipe.click();
  await expect(wipe, 'the first tap arms it').toContainText(/terug|undone/);
  await wipe.click();
  await expect(sec.locator('.cc-mydata__own-actions-count')).toContainText(/gewist|wiped/);
  expect(await rows(page), 'the record is empty').toEqual([]);

  // off: it says so, and nothing new is kept from then on
  await sec.locator('.cc-mydata__own-actions-toggle').click();
  await expect(page.locator('[data-section="own-actions"] .cc-mydata__own-actions-off')).toContainText(/niets bijgehouden|Nothing is being recorded/, { timeout: 5000 });
  const afterOff = (await rows(page)).length;
  await page.evaluate(async () => { await window.onderlingCall('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 62_000 }); });
  await page.locator('[data-tab="vandaag"]').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  expect((await rows(page)).length, 'switched off: nothing new').toBe(afterOff);
  expect(errs).toEqual([]);
});
