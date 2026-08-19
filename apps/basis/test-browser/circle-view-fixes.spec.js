import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

// Fixes from the 2026-06-12 real-run review of the circle bot:
//   #2 infra ops (/me) scoped out → graceful, not a raw "circle.bot.failed" key / crash
//   #3 bare picker command (/complete-task) lists options, not «couldn't find ""»
//   #4 feedback echoes the user's own messages — RETIRED with the in-circle feedback mount (F2 2026-07-08)
//   #5 add vs complete replies are distinct (Added: / Completed:), not an identical "✓ X"
test.setTimeout(70000);

async function openCircleComposer(page) {
  // Delegates to the ONE shared boot (test-browser/helpers.js). Six specs each carried a copy of
  // this, and all six broke the same way when the product changed twice underneath them.
  // `{ tasks: true }` — `@assistant add X` is gated on the per-circle tasks feature, which a
  // wizard-created circle starts with OFF.
  await bootCircle(page, 'P5 Circle', { tasks: true });
}
async function send(page, text) {
  await page.locator('.circle-circle__composer-input').fill(text);
  await page.locator('.circle-circle__composer-send').click();
  await page.waitForTimeout(2500);
}
const blob = async (page) => (await page.locator('.circle-circle__bubble').allTextContents()).join(' | ');

test('#5 add vs complete replies are distinct (Added: / Completed:)', async ({ page }) => {
  await openCircleComposer(page);
  await send(page, '@assistant add distinctmilk');
  expect(await blob(page)).toMatch(/Added:\s*distinctmilk/i);
  await send(page, '@assistant done distinctmilk');
  expect(await blob(page)).toMatch(/Completed:\s*distinctmilk/i);
});

test('#2 /me is scoped out — graceful reply, no raw locale key, no page crash', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await openCircleComposer(page);
  await send(page, '/me');
  const b = await blob(page);
  expect(b, `raw locale key leaked: ${b}`).not.toMatch(/circle\.bot\./);
  expect(b).toMatch(/couldn.t turn that into an action/i);
  expect(errs).toEqual([]);
});

test('#3 bare /complete-task lists options, never «couldn\'t find ""»', async ({ page }) => {
  await openCircleComposer(page);
  await send(page, '@assistant add pickme');      // guarantee at least one open task
  await send(page, '/complete-task');             // bare picker → should ask which / list, not "couldn't find ''"
  const b = await blob(page);
  expect(b, b).not.toMatch(/couldn.t find/i);
  expect(b).toMatch(/which one do you mean|nothing to pick/i);
});

// (F2, 2026-07-08) The `#4 feedback echoes` test was retired with the in-circle feedback mount. The user↔bot
// echo now lives in the fp-bot contact thread (createFeedbackMount, covered by the feedbackMount vitest).
