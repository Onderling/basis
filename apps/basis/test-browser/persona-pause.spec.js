/**
 * PAUSE A PERSONA ON THIS DEVICE, on a real screen: Werk is made; paused, after a reload it is gone from the switcher
 * (it does not run here); resumed, after a reload it is back. Nothing is asked for — no phrase.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/persona-pause.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(150_000);
const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const ready = async (page) => { await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true); await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 }); };
const selves = async (page) => {
  await page.locator('.cc-header-avatar__button').click();
  const n = await page.locator('.cc-persona-switcher__row').count();
  const ids = n ? await page.locator('.cc-persona-switcher__row').evaluateAll((els) => els.map((e) => e.dataset.self)) : [];
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.cc-persona-switcher__close, .cc-screen-panel__close').first().click({ timeout: 3000 }).catch(() => {});
  return ids;
};

test('a paused persona leaves this device, a resumed one comes back — no phrase', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/'); await ready(page);
  const made = await call(page, 'agents', 'createProfile', { name: 'Werk' });
  expect(made?.created, JSON.stringify(made)).toBe(true);
  await page.reload(); await ready(page);
  expect(await selves(page), 'Werk runs here').toContain(made.id);

  expect(await call(page, 'household', 'pausePersona', { personaId: made.id })).toMatchObject({ ok: true, reloadRequired: true });
  await page.reload(); await ready(page);
  expect(await selves(page), 'paused: Werk is not on this device now').not.toContain(made.id);
  const here = await call(page, 'household', 'listPersonasHere', {});
  expect(here.personas.find((p) => p.id === made.id)).toMatchObject({ paused: true, running: false });

  expect(await call(page, 'household', 'resumePersona', { personaId: made.id })).toMatchObject({ ok: true });
  await page.reload(); await ready(page);
  expect(await selves(page), 'resumed: Werk is back').toContain(made.id);
  expect(errs).toEqual([]);
});
