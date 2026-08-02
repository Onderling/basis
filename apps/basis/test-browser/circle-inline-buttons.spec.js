import { test, expect } from '@playwright/test';
import { bootKring } from './helpers.js';

// S6.A e2e — manifest-driven inline buttons on a bot reply. The deterministic
// gate ("@assistant add X" → addTask) dispatches a real task op; the reply must
// now carry a `[Claim · X]` inline button (computeEmbedButtons over the tasks
// manifest, appliesTo state:open), and tapping it dispatches claimTask.
test.setTimeout(70000);

async function openKringComposer(page) {
  // Delegates to the ONE shared boot (test-browser/helpers.js). Six specs each carried a copy of
  // this, and all six broke the same way when the product changed twice underneath them.
  await bootKring(page, 'S6A Circle');
}

async function send(page, text) {
  await page.locator('.circle-kring__composer-input').fill(text);
  await page.locator('.circle-kring__composer-send').click();
  await page.waitForTimeout(2500);
}

test('adding a task renders an inline Claim button on the bot reply, and it dispatches', async ({ page }) => {
  await openKringComposer(page);

  await send(page, '@assistant add s6abuy');

  // The reply card carries the manifest inline button (appliesTo state:open → Claim).
  const claim = page.locator('.circle-kring__embed-button', { hasText: /claim/i });
  await expect(claim.first()).toBeVisible({ timeout: 8000 });
  await expect(claim.first()).toHaveAttribute('data-op-id', 'claimTask');

  // Scope marker: adding a task is a mutating op → its reply reaches the whole kring;
  // the user's own typed line is broadcast too. Both carry the "whole kring" badge.
  await expect(page.locator('.circle-kring__scope--kring').first()).toBeVisible({ timeout: 8000 });

  // Tapping it dispatches claimTask against the item → a new bot reply, no error.
  const before = await page.locator('.circle-kring__bubble').count();
  await claim.first().click();
  await page.waitForTimeout(2500);
  const after = await page.locator('.circle-kring__bubble').allTextContents();
  expect(after.length).toBeGreaterThan(before);          // a reply to the claim
  const blob = after.join(' | ').toLowerCase();
  expect(blob).not.toContain('item not found');
  expect(blob).not.toContain('couldn');
});

async function enableTasksFeature(page) {
  await page.locator('.circle-kring__more').click();
  await page.locator('.circle-kring__more-item[data-action="settings"]').click();
  await page.waitForTimeout(800);
  const box = page.locator('input[data-feature="tasks"]');
  await expect(box).toBeVisible({ timeout: 5000 });
  if (!(await box.isChecked())) await box.check();
  await page.locator('.circle-settings__save').click();   // persist (toggle alone only edits local state)
  await page.waitForTimeout(800);
  const back = page.locator('.circle-settings__back');
  if (await back.count()) { await back.click(); await page.waitForTimeout(800); }
  const chat = page.locator('.circle-kring__view-toggle-btn', { hasText: 'Chat' });
  if (await chat.count()) { await chat.click(); await page.waitForTimeout(800); }
}

test('S6.C gate + S6.B — the tasks screen is gated per-circle; enabling tasks reveals the panel', async ({ page }) => {
  await openKringComposer(page);
  await send(page, '@assistant add s6bpanel');

  // S6.C — tasks default OFF for a circle ⇒ the dedicated screen surface is gated:
  // listMine still lists, but offers NO "All tasks →" screen button.
  await send(page, '/mytasks');
  await expect(page.locator('.circle-kring__screen-button')).toHaveCount(0);

  // Enable tasks for THIS circle (the per-circle on/off), then it appears.
  await enableTasksFeature(page);
  await send(page, '/mytasks');
  const screenBtn = page.locator('.circle-kring__screen-button');
  await expect(screenBtn.first()).toBeVisible({ timeout: 8000 });
  await expect(screenBtn.first()).toHaveAttribute('data-screen', 'tasks');

  // S6.B — tapping it opens the tasks panel (the Schermen tasks block in an overlay).
  await screenBtn.first().click();
  await expect(page.locator('.cc-screen-panel')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.cc-screen-panel .circle-screen__block--tasks')).toBeVisible();
  await expect(page.locator('.cc-screen-panel')).toContainText('s6bpanel');
});

test('S6.C deep — scoping an app out of the circle (policy.apps) drops its commands from the catalog', async ({ page }) => {
  await openKringComposer(page);

  // Tasks is composed by default (policy.apps = all) → /addtask dispatches + confirms.
  await send(page, '/addtask scopeon');
  let bubbles = (await page.locator('.circle-kring__bubble').allTextContents()).join(' | ');
  expect(bubbles).toContain('scopeon');

  // Uncheck the Tasks app in settings → it leaves THIS circle's catalog.
  await page.locator('.circle-kring__more').click();
  await page.locator('.circle-kring__more-item[data-action="settings"]').click();
  await page.waitForTimeout(800);
  const taskApp = page.locator('input[data-app="tasks"]');
  await expect(taskApp).toBeVisible({ timeout: 5000 });
  await taskApp.uncheck();
  await page.locator('.circle-settings__save').click();
  await page.waitForTimeout(800);
  const back = page.locator('.circle-settings__back');
  if (await back.count()) { await back.click(); await page.waitForTimeout(800); }
  const chat = page.locator('.circle-kring__view-toggle-btn', { hasText: 'Chat' });
  if (await chat.count()) { await chat.click(); await page.waitForTimeout(800); }

  // Now /addtask is not in the scoped catalog → the bot can't resolve it.
  await send(page, '/addtask scopeoff');
  bubbles = (await page.locator('.circle-kring__bubble').allTextContents()).join(' | ').toLowerCase();
  expect(bubbles).toContain('turn that into an action');   // circle.bot.unknown — addTask is gone
});

test('Theme B — the guided-setup chatbot walks the basics + pre-fills the settings form', async ({ page }) => {
  await openKringComposer(page);
  await page.locator('.circle-kring__more').click();
  await page.locator('.circle-kring__more-item[data-action="settings"]').click();
  await page.waitForTimeout(800);

  // A fresh circle composes ALL apps (policy.apps = null) → every app box is checked.
  await expect(page.locator('input[data-app="stoop"]')).toBeChecked();

  await page.locator('.circle-settings__guided').click();              // open the chatbot
  await expect(page.locator('.cc-guided')).toBeVisible({ timeout: 5000 });

  await page.locator('.cc-guided__btn--primary').click();              // intro → apps
  // apps step (multiselect): pick ONLY Tasks, continue → narrows policy.apps
  await page.locator('.cc-guided input[data-value="tasks"]').check();
  await page.locator('.cc-guided__btn--primary').click();
  await page.locator('.cc-guided__btn--option').first().click();       // storage (choice)
  await page.locator('.cc-guided__btn--option').first().click();       // AI (choice)
  if (await page.locator('.cc-guided__btn--primary').count()) {
    await page.locator('.cc-guided__btn--primary').click();            // done → hand off
  }

  // Hand-off: panel closed, settings form PRE-FILLED — apps narrowed to just Tasks.
  await expect(page.locator('.cc-guided')).toHaveCount(0);
  await expect(page.locator('input[data-app="tasks"]')).toBeChecked({ timeout: 5000 });
  await expect(page.locator('input[data-app="stoop"]')).not.toBeChecked();
});
