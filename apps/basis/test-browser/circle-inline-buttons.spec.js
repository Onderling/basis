import { test, expect } from '@playwright/test';
import { bootCircle, enableTasksFeature } from './helpers.js';

// S6.A e2e — manifest-driven inline buttons on a bot reply. The deterministic
// gate ("@assistant add X" → addTask) dispatches a real task op; the reply must
// now carry a `[Claim · X]` inline button (computeEmbedButtons over the tasks
// manifest, appliesTo state:open), and tapping it dispatches claimTask.
test.setTimeout(70000);

async function openCircleComposer(page) {
  // Delegates to the ONE shared boot (test-browser/helpers.js). Six specs each carried a copy of
  // this, and all six broke the same way when the product changed twice underneath them.
  await bootCircle(page, 'S6A Circle');
}

async function send(page, text) {
  await page.locator('.circle-view__composer-input').fill(text);
  await page.locator('.circle-view__composer-send').click();
  await page.waitForTimeout(2500);
}

test('adding a task renders an inline Claim button on the bot reply, and it dispatches', async ({ page }) => {
  // Tasks are OFF for a new circle — the very next test asserts that as the intended default. This test
  // used to inherit tasks-on from whatever circle it happened to land in.
  await bootCircle(page, 'S6A Circle', { tasks: true });

  await send(page, '@assistant add s6abuy');

  // The reply card carries the manifest inline button (appliesTo state:open → Claim).
  const claim = page.locator('.circle-view__embed-button', { hasText: /claim/i });
  await expect(claim.first()).toBeVisible({ timeout: 8000 });
  await expect(claim.first()).toHaveAttribute('data-op-id', 'claimTask');

  // Scope marker: adding a task is a mutating op → its reply reaches the whole circle;
  // the user's own typed line is broadcast too. Both carry the "whole circle" badge.
  await expect(page.locator('.circle-view__scope--circle').first()).toBeVisible({ timeout: 8000 });

  // Tapping it dispatches claimTask against the item → a new bot reply, no error.
  const before = await page.locator('.circle-view__bubble').count();
  await claim.first().click();
  await page.waitForTimeout(2500);
  const after = await page.locator('.circle-view__bubble').allTextContents();
  expect(after.length).toBeGreaterThan(before);          // a reply to the claim
  const blob = after.join(' | ').toLowerCase();
  expect(blob).not.toContain('item not found');
  expect(blob).not.toContain('couldn');
});


test('S6.C gate + S6.B — the tasks screen is gated per-circle; enabling tasks reveals the panel', async ({ page }) => {
  await openCircleComposer(page);
  await send(page, '@assistant add s6bpanel');

  // S6.C — the per-circle FEATURE gate governs the dedicated screen surface.
  //
  // This used to read "tasks default OFF ⇒ no screen button". Tasks is ON by default since 2026-09-08
  // (Frits: the alpha's default tab set is Gesprek · Prikbord · Taken · Leden), so that assertion was
  // asserting a default rather than a gate, and it went red the day the default moved. It now proves the
  // gate by CLOSING it — which is what the test was always for, and stays true whichever way the default
  // points. (The app-scoping gate, `policy.apps`, is a different mechanism and is proven by the next test.)
  // Scoped to the LATEST bubble, never the page. A circle view is a transcript: the reply to the first
  // `/mytasks` keeps its button on screen forever, so a page-wide `toHaveCount(0)` can never pass once
  // anything has answered with one. (It passed before only because the first reply had no button.)
  const lastReplyScreenBtn = () => page.locator('.circle-view__bubble').last().locator('.circle-view__screen-button');

  await send(page, '/mytasks');
  await expect(lastReplyScreenBtn().first(),
    'tasks is on by default — its screen button should be there').toBeVisible({ timeout: 8000 });

  await enableTasksFeature(page, false);          // close the gate for THIS circle
  await send(page, '/mytasks');
  await expect(lastReplyScreenBtn(),
    'the feature is off for this circle — listMine still lists, but offers no screen').toHaveCount(0);

  // …and opening it again brings the surface back.
  await enableTasksFeature(page, true);
  await send(page, '/mytasks');
  const screenBtn = lastReplyScreenBtn();
  await expect(screenBtn.first()).toBeVisible({ timeout: 8000 });
  await expect(screenBtn.first()).toHaveAttribute('data-screen', 'tasks');

  // Tapping it opens the tasks panel in an overlay.
  //
  // The tasks screen renders through `listScreen.js` now, not as a `circle-screen__block--tasks`. Both
  // renderers still exist — blocks are what a composed Screens page uses — so the old selector was not
  // stale everywhere, just for THIS screen, which is the kind of drift a selector cannot tell you about.
  // What matters to the person is unchanged and is what we assert: the panel opens, and their task is in
  // it.
  await screenBtn.first().click();
  await expect(page.locator('.cc-screen-panel')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.cc-screen-panel .list-screen')).toBeVisible();
  await expect(page.locator('.cc-screen-panel')).toContainText('s6bpanel');
});

test('S6.C deep — scoping an app out of the circle (policy.apps) drops its commands from the catalogue', async ({ page }) => {
  await openCircleComposer(page);

  // Tasks is composed by default (policy.apps = all) → /addtask dispatches + confirms.
  await send(page, '/addtask scopeon');
  let bubbles = (await page.locator('.circle-view__bubble').allTextContents()).join(' | ');
  expect(bubbles).toContain('scopeon');

  // Uncheck the Tasks app in settings → it leaves THIS circle's catalogue.
  await page.locator('.circle-view__more').click();
  await page.locator('.circle-view__more-item[data-action="settings"]').click();
  await page.waitForTimeout(800);
  // The app checkboxes moved INTO the advanced fold (`ADVANCED_SETTINGS` includes 'apps'), which is a
  // `<details>` that starts closed — so the checkbox exists but is not visible until it is opened. Open
  // it the way a person does. Guarded, so this still works if 'apps' ever moves back onto the page.
  const advanced = page.locator('.circle-settings__advanced');
  if (await advanced.count() && !(await advanced.first().evaluate((el) => el.open))) {
    await page.locator('.circle-settings__advanced-summary').first().click();
    await page.waitForTimeout(400);
  }
  const taskApp = page.locator('input[data-app="tasks"]');
  await expect(taskApp).toBeVisible({ timeout: 5000 });
  await taskApp.uncheck();
  await page.locator('.circle-settings__save').click();
  await page.waitForTimeout(800);
  const back = page.locator('.circle-settings__back');
  if (await back.count()) { await back.click(); await page.waitForTimeout(800); }
  const chat = page.locator('.circle-view__view-toggle-btn', { hasText: 'Chat' });
  if (await chat.count()) { await chat.click(); await page.waitForTimeout(800); }

  // Now /addtask is not in the scoped catalogue → the bot can't resolve it.
  await send(page, '/addtask scopeoff');
  bubbles = (await page.locator('.circle-view__bubble').allTextContents()).join(' | ').toLowerCase();
  expect(bubbles).toContain('turn that into an action');   // circle.bot.unknown — addTask is gone
});

test('Theme B — the guided-setup chatbot walks the basics + pre-fills the settings form', async ({ page }) => {
  await openCircleComposer(page);
  await page.locator('.circle-view__more').click();
  await page.locator('.circle-view__more-item[data-action="settings"]').click();
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
