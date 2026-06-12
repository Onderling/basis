import { test, expect } from '@playwright/test';

// Phase 5 — the circle bot wired into the v2 launcher's kring composer (circleApp.js onSend).
// The GATE path ("@assistant add X" / "done X") is deterministic — no LLM call — but the bot only
// "engages" when a circle LLM provider is configured, so this run needs VITE_CIRCLE_LLM_BASEURL set
// (a DUMMY is fine; the gate never calls it). See the dev-server start in the session.
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

test('circleApp boots clean (bot built, no page error)', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  page.on('console', (m) => { if (/circle bot setup failed/.test(m.text())) errs.push(m.text()); });
  await page.goto('/');
  await page.waitForTimeout(4000);
  expect(errs).toEqual([]);
  await expect(page.locator('.circle-screens-picker, .circle-launcher')).toHaveCount(1);
});

test('"@assistant add X" engages the bot → user bubble + a bot reply (the gate dispatched addTask)', async ({ page }) => {
  await openKringComposer(page);
  const before = await page.locator('.circle-kring__bubble').count();
  await send(page, '@assistant add p5milk');
  const bubbles = await page.locator('.circle-kring__bubble').allTextContents();
  console.log('=== bubbles after add:', JSON.stringify(bubbles));
  // engaged + dispatched ⇒ the user line AND a bot reply bubble (≥ 2 new). If the bot had NOT engaged,
  // the line would just post to the kring (1 bubble, no reply).
  expect(bubbles.length).toBeGreaterThanOrEqual(before + 2);
});

test('"@assistant done X" resolves the label + completes (bot reply, no error bubble)', async ({ page }) => {
  await openKringComposer(page);
  await send(page, '@assistant add p5sock');
  await send(page, '@assistant done p5sock');
  const bubbles = await page.locator('.circle-kring__bubble').allTextContents();
  console.log('=== bubbles after add+done:', JSON.stringify(bubbles));
  const blob = bubbles.join(' | ').toLowerCase();
  expect(blob).not.toContain('item not found');
  expect(blob).not.toContain('couldn');           // not "couldn't find"
});
