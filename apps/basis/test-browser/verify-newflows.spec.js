/**
 * verify-newflows.spec.js — RUNTIME verification harness (do NOT commit).
 * Drives the basis web app in real Chromium and screenshots five recently-built flows.
 * Forces Dutch (circle.app.lang=nl) so copy matches the product's primary locale.
 * Each test logs what it OBSERVED (bubble text, element presence) to stdout.
 */
import { test, expect } from '@playwright/test';

const SHOTS = '/home/frits/.claude/jobs/c6a31a12/tmp/verify-shots';
test.setTimeout(120_000);

// Every fresh context boots the app in Dutch (headless Chromium's locale is en-US otherwise).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('circle.app.lang', 'nl'); } catch { /* */ }
  });
});

// ── helpers ────────────────────────────────────────────────────────────────
async function gotoCircles(page, newName = 'Verify Circle') {
  page.on('dialog', (d) => d.accept(newName));
  await page.goto('/');
  await page.waitForTimeout(3000);
  await page.locator('[data-tab="circles"]').click();
  await page.waitForTimeout(2000);
}

async function tileNames(page) {
  const tiles = page.locator('.circle-tile');
  const n = await tiles.count();
  const names = [];
  for (let i = 0; i < n; i++) names.push((await tiles.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  return names;
}

async function toChat(page) {
  const chat = page.locator('.circle-view__view-toggle-btn[data-view-mode="chat"]');
  if (await chat.count()) { await chat.first().click(); await page.waitForTimeout(1500); }
}

// Open the auto-provisioned help circle (cc-help / "Onderling") and switch to Chat view.
async function openHelpCircle(page) {
  await gotoCircles(page);
  const names = await tileNames(page);
  let idx = names.findIndex((s) => /onderling|cc-help/i.test(s));
  if (idx < 0) idx = 0;
  await page.locator('.circle-tile').nth(idx).click();
  await page.waitForTimeout(2500);
  await toChat(page);
  return { names, idx };
}

async function bubbleTexts(page) {
  return (await page.locator('.circle-view__bubble').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
}
async function actionButtonLabels(page) {
  const sel = '.circle-view__bubble-action, .circle-view__bubble button';
  return [...new Set((await page.locator(sel).allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}
async function sendCircle(page, text, settle = 3500) {
  await page.locator('.circle-view__composer-input').fill(text);
  await page.locator('.circle-view__composer-send').click();
  await page.waitForTimeout(settle);
}

// ── 1. onboarding ────────────────────────────────────────────────────────────
test('1 onboarding — help circle + Onderling-bot guided chat', async ({ page }) => {
  const { names, idx } = await openHelpCircle(page);
  console.log('OB tiles:', JSON.stringify(names), 'opened idx', idx);
  await page.waitForTimeout(2500);
  console.log('OB bubbles:', JSON.stringify(await bubbleTexts(page)));
  console.log('OB option buttons:', JSON.stringify(await actionButtonLabels(page)));
  await page.screenshot({ path: `${SHOTS}/onboarding.png` });
});

// ── 2. chat restyle ──────────────────────────────────────────────────────────
test('2 chat restyle — bot card border, me vs bot bubbles, compose', async ({ page }) => {
  await openHelpCircle(page);
  await page.waitForTimeout(2000);
  await sendCircle(page, 'hallo');
  const mine = await page.locator('.circle-view__bubble--mine').count();
  const total = await page.locator('.circle-view__bubble').count();
  const composer = await page.locator('.circle-view__composer-input').count();
  const card = page.locator('.circle-view__chat-card').first();
  const border = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.borderTopWidth} ${s.borderStyle} ${s.borderTopColor}`;
  }).catch((e) => 'n/a: ' + e.message);
  const meBg = await page.locator('.circle-view__bubble--mine').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => 'n/a');
  console.log('CR mine-bubbles:', mine, 'total:', total, 'composer:', composer);
  console.log('CR chat-card border:', border);
  console.log('CR me-bubble bg:', meBg);
  await page.screenshot({ path: `${SHOTS}/chat-restyle.png` });
});

// ── 3. help Q&A ───────────────────────────────────────────────────────────────
test('3 help Q&A — deterministic answer + transparency badge, then /help topics', async ({ page }) => {
  await openHelpCircle(page);
  await page.waitForTimeout(2000);
  await sendCircle(page, 'is dit veilig?', 4500);
  const provs = (await page.locator('.circle-view__bubble-provenance').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
  console.log('HELP bubbles after question:', JSON.stringify((await bubbleTexts(page)).slice(-3)));
  console.log('HELP provenance badges:', JSON.stringify(provs));
  await page.screenshot({ path: `${SHOTS}/help-answer.png` });

  await sendCircle(page, '/help', 4000);
  console.log('HELP /help last bubble:', JSON.stringify((await bubbleTexts(page)).slice(-1)));
  console.log('HELP /help topic chips:', JSON.stringify(await actionButtonLabels(page)));
  await page.screenshot({ path: `${SHOTS}/help-topics.png` });
});

// ── 4. theme toggle ───────────────────────────────────────────────────────────
test('4 theme toggle — systeem/licht/donker recolours live', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  await page.locator('[data-tab="mij"]').click();
  await page.waitForTimeout(2000);
  const myData = page.locator('.cc-profile__mydata');
  console.log('THEME mydata button:', await myData.count());
  await myData.first().click();
  await page.waitForTimeout(2000);
  const labels = await page.locator('.cc-mydata__theme-btn').allTextContents();
  console.log('THEME toggle labels:', JSON.stringify(labels.map((s) => s.trim())));
  const read = () => page.evaluate(() => ({
    dataTheme: document.documentElement.dataset.theme || '(none)',
    paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));

  await page.locator('.cc-mydata__theme-btn[data-theme="dark"]').click();
  await page.waitForTimeout(1200);
  console.log('THEME after DONKER:', JSON.stringify(await read()));
  await page.screenshot({ path: `${SHOTS}/theme-dark.png` });

  await page.locator('.cc-mydata__theme-btn[data-theme="light"]').click();
  await page.waitForTimeout(1200);
  console.log('THEME after LICHT:', JSON.stringify(await read()));
  await page.screenshot({ path: `${SHOTS}/theme-light.png` });
});

// ── 5. mandate picker ─────────────────────────────────────────────────────────
// A fresh circle has the `tasks` app OFF (policy default), so /addtask is denied. Enable it via
// Circle settings first, then add a task (I own it) → the owner-only "Toevertrouwen" action appears.
test('5 mandate picker — enable tasks, add a task I own, entrust it', async ({ page }) => {
  await gotoCircles(page, 'Mandate Circle');
  await page.locator('.circle-launcher__new').click();
  await page.waitForTimeout(5000);
  const names = await tileNames(page);
  let idx = names.findIndex((s) => /mandate/i.test(s));
  if (idx < 0) idx = names.length - 1;
  const openCircle = async () => {
    await page.locator('.circle-tile').nth(idx).click();
    await page.waitForTimeout(2500);
    await toChat(page);
  };
  await openCircle();

  // Open ⋯ → Circle settings, tick the `tasks` feature, save.
  await page.locator('.circle-view__more').click();
  await page.waitForTimeout(600);
  await page.locator('.circle-view__more-item[data-action="settings"]').click();
  await page.waitForTimeout(2000);
  const tasksBox = page.locator('input[data-feature="tasks"]');
  console.log('MANDATE tasks checkbox present:', await tasksBox.count());
  if (await tasksBox.count()) {
    if (!(await tasksBox.first().isChecked())) await tasksBox.first().check();
    await page.waitForTimeout(400);
  }
  await page.locator('.circle-settings__save').click();
  await page.waitForTimeout(2000);

  // Re-open the circle (policy persisted to localStorage) and add a task.
  await gotoCircles(page, 'Mandate Circle');
  await openCircle();
  await sendCircle(page, '/addtask verf kopen', 4000);
  console.log('MANDATE chat bubbles:', JSON.stringify((await bubbleTexts(page)).slice(-2)));

  // The task-kind row with the owner-only entrust chip lives in the TAKEN (tasks) tab, not the chat stream.
  const tabs = page.locator('.circle-view__tab');
  const tabLabels = await tabs.allTextContents();
  console.log('MANDATE circle tabs:', JSON.stringify(tabLabels.map((s) => s.trim())));
  const takenIdx = tabLabels.findIndex((s) => /taken|task/i.test(s));
  if (takenIdx >= 0) {
    await tabs.nth(takenIdx).click();
    await page.waitForTimeout(2500);
    const taskRows = page.locator('.circle-view__task');
    const rowCount = await taskRows.count();
    const rowText = rowCount ? (await taskRows.first().innerText()).replace(/\s+/g, ' ').trim() : '(no rows)';
    console.log('MANDATE TAKEN-tab task rows:', rowCount, 'first row:', JSON.stringify(rowText));
    console.log('MANDATE TAKEN-tab actions:', JSON.stringify(await actionButtonLabels(page)));
    await page.screenshot({ path: `${SHOTS}/taken-tab.png` });
  }

  const mandBtn = page.locator('.circle-view__bubble-action--mandate');
  const mandCount = await mandBtn.count();
  console.log('MANDATE row-action buttons:', JSON.stringify(await actionButtonLabels(page)), 'entrust-btn:', mandCount);
  if (mandCount > 0) {
    await mandBtn.first().click();
    await page.waitForTimeout(2000);
    const picker = page.locator('.cc-mandate-picker');
    const txt = (await picker.count()) ? (await picker.innerText()).replace(/\s+/g, ' ').trim() : '(picker not found)';
    console.log('MANDATE picker present:', await picker.count(), 'text:', JSON.stringify(txt.slice(0, 800)));
    expect(await picker.count()).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/mandate-open.png` });
  } else {
    console.log('MANDATE: BLOCKED — no entrust action on the task row');
    await page.screenshot({ path: `${SHOTS}/mandate.png` });
  }
});
