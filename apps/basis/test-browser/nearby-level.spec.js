/**
 * THE NEARBY LEVEL, through the real web agent: set on a persona by the one writer (`household.setNearbyLevel`), read
 * back after a reload from that persona's disclosure under `nearby`; the general disclosure op refuses the reserved
 * context. (The Nearby tab is hidden in the alpha, so this drives the op, not the screen — the painters have DOM tests.)
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/nearby-level.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);
const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const ready = async (page) => { await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true); await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 }); };
const nearbyOf = async (page, id) => (await call(page, 'agents', 'getProfileDisclosure', { id }))?.disclosure?.perContext?.nearby ?? null;

test('a persona\'s Nearby level is written by its one op and survives a reload', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/'); await ready(page);
  const made = await call(page, 'agents', 'createProfile', { name: 'Werk' });
  expect(made?.created, JSON.stringify(made)).toBe(true);
  expect(await nearbyOf(page, made.id), 'nothing set yet: the floor default').toBe(null);

  const set = await call(page, 'household', 'setNearbyLevel', { personaId: made.id, level: 'profile' });
  expect(set, JSON.stringify(set)).toMatchObject({ ok: true });
  expect(await call(page, 'household', 'setNearbyLevel', { personaId: made.id, level: 'loud' })).toMatchObject({ ok: false, error: 'unknown-level' });
  expect(await call(page, 'agents', 'setProfileDisclosure', { id: made.id, contextId: 'nearby', key: 'handle', enabled: true })).toMatchObject({ ok: false, reason: 'reserved-context' });

  await page.reload(); await ready(page);
  await expect.poll(async () => (await nearbyOf(page, made.id))?.['_nearby.level']?.rung ?? null, { timeout: 20_000, message: 'the level is the persona\'s, kept' }).toBe('profile');
  expect(await nearbyOf(page, 'default'), 'the general persona is untouched').toBe(null);
  expect(errs).toEqual([]);
});
