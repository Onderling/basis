/**
 * DATA THIS DEVICE KEEPS BUT CANNOT READ IS SAID, AND NOT SAVED OVER — in the real web app.
 *
 * The household store's snapshot is written by "a newer build" (an unknown format version) before the app has ever
 * run in this browser. The app starts, the store keeps those bytes and refuses to save over them, and the circles
 * launcher shows the one shared notice: update the app, and what is changed in lists meanwhile is only saved after
 * the update. The bytes in IndexedDB are the seeded ones after a reload.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/unreadable-store-notice.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const NEWER = JSON.stringify({ v: 99, data: { 'mem://x/items/a': '{"title":"from a newer build"}' } });

/** Put the snapshot where the web household store reads it (`cc-household-state` / `items` / `state`). */
async function seed(page, raw) {
  await page.evaluate((value) => new Promise((resolve, reject) => {
    const req = indexedDB.open('cc-household-state', 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('items');
    req.onerror = (e) => reject(e.target.error);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').put(value, 'state');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = (ev) => reject(ev.target.error);
    };
  }), raw);
}
const stored = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('cc-household-state', 1);
  req.onerror = (e) => reject(e.target.error);
  req.onsuccess = (e) => {
    const db = e.target.result;
    const g = db.transaction('items', 'readonly').objectStore('items').get('state');
    g.onsuccess = () => { db.close(); resolve(g.result); };
    g.onerror = (ev) => reject(ev.target.error);
  };
}));

test('a newer build\'s household snapshot: the launcher says so, and the bytes stay as they were', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  // a same-origin page that is not the app: the store is seeded before the app has ever run here
  await page.goto('/version.json').catch(() => {});
  await seed(page, NEWER);

  await page.goto('/');
  await page.locator('[data-tab="circles"]').first().click({ timeout: 30_000 });
  const notice = page.locator('.circle-launcher__store-notice');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toContainText('newer version of Basis');
  await expect(notice).toContainText('in lists is only saved after the update');

  await page.reload();
  await page.locator('[data-tab="circles"]').first().click({ timeout: 30_000 });
  await expect(notice).toBeVisible({ timeout: 20_000 });
  expect(await stored(page), 'the newer build\'s snapshot was saved over').toBe(NEWER);
  expect(errs).toEqual([]);
});
