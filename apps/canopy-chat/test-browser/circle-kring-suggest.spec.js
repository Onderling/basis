import { test, expect } from '@playwright/test';

// Composer parity — the v2 kring composer now has the classic shell's slash-command auto-suggest
// dropdown + bash-style input history (shared src/v2/commandSuggest.js, web↔mobile). These verify
// the WEB rendering/keyboard wiring (circleKring.js + circleApp.js).
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

test('slash-suggest dropdown opens on "/", filters by prefix, and closes after a space', async ({ page }) => {
  await openKringComposer(page);
  const input = page.locator('.circle-kring__composer-input');
  const suggest = page.locator('.circle-kring__suggest');

  await input.fill('/');                         // bare slash → the whole pool
  await input.dispatchEvent('input');
  await expect(suggest).toBeVisible();
  expect(await page.locator('.circle-kring__suggest-item').count()).toBeGreaterThan(1);

  await input.fill('/comp');                     // prefix filter
  await input.dispatchEvent('input');
  const cmds = await page.locator('.circle-kring__suggest-cmd').allTextContents();
  expect(cmds).toContain('/complete-task');
  expect(cmds.every((c) => c.startsWith('/comp'))).toBe(true);

  await input.fill('/addtask milk');             // space → into args → list closes
  await input.dispatchEvent('input');
  await expect(suggest).toBeHidden();
});

test('Tab accepts the highlighted suggestion (full command + trailing space)', async ({ page }) => {
  await openKringComposer(page);
  const input = page.locator('.circle-kring__composer-input');
  await input.fill('/comp');
  await input.dispatchEvent('input');
  await expect(page.locator('.circle-kring__suggest')).toBeVisible();
  await input.press('Tab');
  expect(await input.inputValue()).toBe('/complete-task ');
  await expect(page.locator('.circle-kring__suggest')).toBeHidden();
});

test('Escape dismisses the dropdown without accepting', async ({ page }) => {
  await openKringComposer(page);
  const input = page.locator('.circle-kring__composer-input');
  await input.fill('/comp');
  await input.dispatchEvent('input');
  await expect(page.locator('.circle-kring__suggest')).toBeVisible();
  await input.press('Escape');
  await expect(page.locator('.circle-kring__suggest')).toBeHidden();
  expect(await input.inputValue()).toBe('/comp');     // text untouched
});

test('ArrowUp recalls the last sent message (bash-style history)', async ({ page }) => {
  await openKringComposer(page);
  const input = page.locator('.circle-kring__composer-input');
  // Send a plain message (no leading slash → no suggest interference, goes to fan-out/bot).
  await input.fill('hello kring');
  await page.locator('.circle-kring__composer-send').click();
  await page.waitForTimeout(1500);
  expect(await input.inputValue()).toBe('');          // cleared after send
  await input.focus();
  await input.press('ArrowUp');
  expect(await input.inputValue()).toBe('hello kring');
  await input.press('ArrowDown');                     // forward past newest → restores the (empty) draft
  expect(await input.inputValue()).toBe('');
});
