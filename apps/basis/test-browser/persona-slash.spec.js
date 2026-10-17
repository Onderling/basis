/**
 * THE PERSONA SLASH COMMANDS, on a real screen: in a circle's composer, `/pauze Werk` pauses Werk on this device by name
 * and answers in the screen's own words; `/hier` lists the selves with their state; `/hervat Werk` undoes it.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/persona-slash.spec.js
 */
import { test, expect } from '@playwright/test';
import { gotoCircles, createCircle, openCircleMatching, toChat, sendChat, readBubbles } from './peerHarness.js';

test.setTimeout(180_000);
const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const ready = async (page) => { await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true); await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 }); };
const pausedHere = async (page, id) => ((await call(page, 'household', 'listPersonasHere', {}))?.personas ?? []).find((p) => p.id === id)?.paused === true;

test('/pauze Werk, /hier, /hervat Werk — typed in a circle, by name', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/'); await ready(page);
  const made = await call(page, 'agents', 'createProfile', { name: 'Werk' });
  expect(made?.created, JSON.stringify(made)).toBe(true);
  await gotoCircles(page);
  await createCircle(page, 'Slash proef');
  await gotoCircles(page);
  await openCircleMatching(page, /Slash proef/);
  await toChat(page);

  await sendChat(page, '/pauze Werk');
  await expect.poll(() => pausedHere(page, made.id), { timeout: 20_000, message: 'Werk is paused on this device' }).toBe(true);
  await expect.poll(async () => (await readBubbles(page)).some((b) => b.includes('Werk') && /herstart|opnieuw start|restart/i.test(b)), { timeout: 15_000, message: 'the screen\'s own words' }).toBe(true);

  await sendChat(page, '/hier');
  await expect.poll(async () => (await readBubbles(page)).some((b) => b.includes('• Werk —')), { timeout: 15_000, message: '/hier lists Werk with its state' }).toBe(true);

  await sendChat(page, '/hervat Werk');
  await expect.poll(() => pausedHere(page, made.id), { timeout: 20_000, message: 'resumed' }).toBe(false);
  expect(errs).toEqual([]);
});
