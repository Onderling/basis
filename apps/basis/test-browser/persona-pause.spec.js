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
// which selves RUN on this device — the agent's own answer (the switcher's paint has its own spec, persona-switcher)
const running = async (page) => ((await call(page, 'household', 'listPersonasHere', {}))?.personas ?? []).filter((p) => p.running).map((p) => p.id);

test('a paused persona leaves this device, a resumed one comes back — no phrase', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/'); await ready(page);
  const made = await call(page, 'agents', 'createProfile', { name: 'Werk' });
  expect(made?.created, JSON.stringify(made)).toBe(true);
  await page.reload(); await ready(page);
  await expect.poll(() => running(page), { timeout: 20_000, message: 'Werk runs here' }).toContain(made.id);

  expect(await call(page, 'household', 'pausePersona', { personaId: made.id })).toMatchObject({ ok: true, reloadRequired: true });
  await page.reload(); await ready(page);
  await expect.poll(() => running(page), { timeout: 20_000, message: 'paused: Werk does not run here now' }).not.toContain(made.id);
  const here = await call(page, 'household', 'listPersonasHere', {});
  expect(here.personas.find((p) => p.id === made.id)).toMatchObject({ paused: true, running: false });

  expect(await call(page, 'household', 'resumePersona', { personaId: made.id })).toMatchObject({ ok: true });
  await page.reload(); await ready(page);
  await expect.poll(() => running(page), { timeout: 20_000, message: 'resumed: Werk is back' }).toContain(made.id);
  expect(errs).toEqual([]);
});
