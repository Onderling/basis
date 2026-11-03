/**
 * VANDAAG AFTER A BOOT WITH DATA ALREADY THERE (live regression, v0.1.79). A person opens the app on a device that
 * already holds their appointments: Today must show them on the first landing after the boot — not only once something
 * changes while the page is shown.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag-after-boot.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const itemsText = (page) => page.locator('.circle-screen__block[data-block-type="items"]').allInnerTexts().then((t) => t.join(' | '));

test('an appointment already on the device shows on Today after a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head'), 'the app opens on Vandaag').toBeVisible({ timeout: 20_000 });
  const when = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(10, 0, 0, 0); return d.toISOString(); });
  const made = await page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'tandarts', when: w }), when);
  expect(made?.ok, JSON.stringify(made)).toBe(true);
  await expect.poll(() => itemsText(page), { timeout: 20_000, message: 'shown while the page is open' }).toContain('tandarts');
  // the boot: the appointment is already on the device
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => itemsText(page), { timeout: 20_000, message: 'shown on the first landing after the boot' }).toContain('tandarts');
});

test('a task in a circle, already on the device, shows on Today after a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const r = await page.evaluate(async () => {
    const g = await window.onderlingCall('pinboard', 'createGroupV2', { groupId: 'thuis-today', name: 'Thuis', rules: { text: 't' } });
    const t = await window.onderlingCall('tasks', 'addTask', { text: 'vuilnis buiten', circleId: 'thuis-today' });
    const id = t?.itemId ?? t?.task?.id ?? t?.id;
    const c = id ? await window.onderlingCall('tasks', 'claimTask', { id, circleId: 'thuis-today' }) : null;
    return { g: g?.groupId ?? g, t, c };
  });
  expect(r.g, JSON.stringify(r)).toBe('thuis-today');
  await expect.poll(() => itemsText(page), { timeout: 20_000, message: 'shown while the page is open' }).toContain('vuilnis buiten');
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => itemsText(page), { timeout: 20_000, message: 'shown on the first landing after the boot' }).toContain('vuilnis buiten');
});
