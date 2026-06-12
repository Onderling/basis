import { test, expect } from '@playwright/test';

// Fixes from the 2026-06-12 real-run review of the kring bot:
//   #2 infra ops (/me) scoped out → graceful, not a raw "circle.bot.failed" key / crash
//   #3 bare picker command (/complete-task) lists options, not «couldn't find ""»
//   #4 feedback echoes the user's own messages (they used to vanish until /feedback-stop)
//   #5 add vs complete replies are distinct (Added: / Completed:), not an identical "✓ X"
test.setTimeout(70000);

async function openKringComposer(page) {
  page.on('dialog', (d) => d.accept('P5 Circle'));
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.locator('[data-tab="kringen"]').click();
  await page.waitForTimeout(1500);
  if (await page.locator('.circle-tile').count() === 0) {
    await page.locator('.circle-launcher__new').click();
    await page.waitForTimeout(5000);
  }
  await page.locator('.circle-tile').first().click();
  await page.waitForTimeout(2500);
  await page.locator('.circle-kring__view-toggle-btn', { hasText: 'Chat' }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.circle-kring__composer-input')).toBeVisible();
}
async function send(page, text) {
  await page.locator('.circle-kring__composer-input').fill(text);
  await page.locator('.circle-kring__composer-send').click();
  await page.waitForTimeout(2500);
}
const blob = async (page) => (await page.locator('.circle-kring__bubble').allTextContents()).join(' | ');

test('#5 add vs complete replies are distinct (Added: / Completed:)', async ({ page }) => {
  await openKringComposer(page);
  await send(page, '@assistant add distinctmilk');
  expect(await blob(page)).toMatch(/Added:\s*distinctmilk/i);
  await send(page, '@assistant done distinctmilk');
  expect(await blob(page)).toMatch(/Completed:\s*distinctmilk/i);
});

test('#2 /me is scoped out — graceful reply, no raw locale key, no page crash', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await openKringComposer(page);
  await send(page, '/me');
  const b = await blob(page);
  expect(b, `raw locale key leaked: ${b}`).not.toMatch(/circle\.bot\./);
  expect(b).toMatch(/couldn.t turn that into an action/i);
  expect(errs).toEqual([]);
});

test('#3 bare /complete-task lists options, never «couldn\'t find ""»', async ({ page }) => {
  await openKringComposer(page);
  await send(page, '@assistant add pickme');      // guarantee at least one open task
  await send(page, '/complete-task');             // bare picker → should ask which / list, not "couldn't find ''"
  const b = await blob(page);
  expect(b, b).not.toMatch(/couldn.t find/i);
  expect(b).toMatch(/which one do you mean|nothing to pick/i);
});

test('#4 feedback echoes the user\'s messages (no longer vanish until /feedback-stop)', async ({ page }) => {
  await openKringComposer(page);
  await send(page, '/feedback');                  // enter feedback mode (guidance bubble)
  await send(page, 'my private note one');        // a collected feedback message
  const b = await blob(page);
  expect(b, `feedback message was not echoed: ${b}`).toContain('my private note one');
});
