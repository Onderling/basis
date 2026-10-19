/**
 * THE SETTINGS, PROJECTED FROM THE PARAMETER REGISTER. With the developer switch on, Mij offers the Advanced screen;
 * its settings are the register's settable values, each with its label and the control its kind takes. Changing one
 * goes through the one `set-param` op, and the register holds the new value.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-from-register.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const paramOf = (page, key) => page.evaluate(async (k) => (await window.onderlingCall('params', 'get-param', { key: k }))?.value, key);

test('a choice and a switch change the register\'s value through the projected controls', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const on = await page.evaluate(async () => window.onderlingCall('params', 'set-param', { key: 'app.developer', value: true }));
  expect(on?.ok, JSON.stringify(on)).toBe(true);
  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__advanced').click();
  await expect(page.locator('.cc-settings__group[data-scope="device"]')).toBeVisible({ timeout: 20_000 });
  // labels, not raw keys, name the rows; the key stays small beside them
  await expect(page.locator('.cc-settings__row[data-param="display.theme"] label')).not.toHaveText('display.theme');

  await page.locator('select[data-param="surface.pref"]').selectOption('screen');
  await expect.poll(() => paramOf(page, 'surface.pref')).toBe('screen');
  const sw = page.locator('input[type="checkbox"][data-param="wake.nudges"]');
  const was = await sw.isChecked();
  await sw.setChecked(!was);
  await expect.poll(() => paramOf(page, 'wake.nudges')).toBe(!was);
  // a duration takes its unit: 30 minutes for a nearby question, typed as 45 → 45 minutes in ms
  const ttl = page.locator('input[data-param="nearby.ask.defaultTtlMs"]');
  await ttl.fill('45'); await ttl.blur();
  await expect.poll(() => paramOf(page, 'nearby.ask.defaultTtlMs')).toBe(45 * 60_000);
  expect(errs).toEqual([]);
});
