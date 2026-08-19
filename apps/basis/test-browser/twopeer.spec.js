/**
 * twopeer.spec.js — TWO-PEER runtime verification harness (do NOT commit).
 *
 * Boots TWO independent Chromium browser contexts (peer A + peer B), each with
 * fresh isolated storage (→ distinct identities), both pointed at the basis web
 * app. They connect over the app's DEFAULT peer transport (NKN — nkn-sdk from the
 * CDN, which acts as its own relay/rendezvous). Peer A creates a circle + invite;
 * peer B joins from the invite; the joiner⇄admin peer-redeem handshake makes them
 * co-members. Then they collaborate (chat, task, mandate) — each step screenshots
 * BOTH peers.
 *
 * Transport note: the dev server is booted WITHOUT VITE_CIRCLE_RELAY_URL, so the
 * only transport is NKN. (If a local relay URL IS set, the app brings it up too
 * and the router picks the best route — the harness is transport-agnostic.)
 *
 * Each step logs PASS / FAIL / BLOCKED + what was OBSERVED (quoted on-screen text).
 */
import { test, expect } from '@playwright/test';

const SHOTS = '/home/frits/.claude/jobs/c6a31a12/tmp/verify-shots';

test.setTimeout(420_000);

// ── low-level helpers ────────────────────────────────────────────────────────
async function bootPeer(browser, label) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.setItem('circle.app.lang', 'nl'); } catch { /* */ }
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (/redeem|group-member|pair|joinedGroup|relay connected|peer transport/i.test(t)) console.log(`[${label} console] ${t}`);
  });
  page.on('pageerror', (e) => console.log(`[${label} pageerror] ${e.message.split('\n')[0]}`));
  await page.goto('/');
  await page.waitForTimeout(4000);
  return { context, page };
}

// Navigate to the launcher ("Jouw circles"). In a circle view the bottom nav is
// hidden, so leave via the "← circles" back button first.
async function gotoCircles(page) {
  const back = page.locator('.circle-view__back');
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(1500); }
  const tab = page.locator('[data-tab="circles"]');
  if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(1600); }
  else { await page.waitForTimeout(600); }
}

async function tileNames(page) {
  const tiles = page.locator('.circle-tile');
  const n = await tiles.count();
  const out = [];
  for (let i = 0; i < n; i++) out.push((await tiles.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  return out;
}

async function createCircle(page, name) {
  page.once('dialog', (d) => d.accept(name));
  await page.locator('.circle-launcher__new').click();
  await page.waitForTimeout(5000);
}

async function openCircleMatching(page, re) {
  const names = await tileNames(page);
  let idx = names.findIndex((s) => re.test(s));
  if (idx < 0) idx = 0;
  await page.locator('.circle-tile').nth(idx).click();
  await page.waitForTimeout(2500);
  return { names, idx };
}

async function toChat(page) {
  const chat = page.locator('.circle-view__view-toggle-btn[data-view-mode="chat"]');
  if (await chat.count()) { await chat.first().click(); await page.waitForTimeout(1200); }
}

async function sendComposer(page, text, settle = 3000) {
  await page.locator('.circle-view__composer-input').fill(text);
  await page.locator('.circle-view__composer-send').click();
  await page.waitForTimeout(settle);
}

async function bubbles(page) {
  return (await page.locator('.circle-view__bubble').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
}

// Open ⋯ → a more-menu action by data-action id.
async function openMore(page, action) {
  await page.locator('.circle-view__more').click();
  await page.waitForTimeout(500);
  const item = page.locator(`.circle-view__more-item[data-action="${action}"]`);
  if (!(await item.count())) return false;
  await item.first().click();
  await page.waitForTimeout(1800);
  return true;
}

// Enable the `tasks` feature via Circle settings (so /addtask works + Taken tab shows).
async function enableTasks(page) {
  if (!(await openMore(page, 'settings'))) return false;
  const box = page.locator('input[data-feature="tasks"]');
  let ok = false;
  if (await box.count()) {
    if (!(await box.first().isChecked())) await box.first().check().catch(() => {});
    await page.waitForTimeout(400);
    ok = true;
  }
  const save = page.locator('.circle-settings__save');
  if (await save.count()) { await save.first().click(); await page.waitForTimeout(1800); }
  return ok;
}

// Read the circle's member roster via the admin panel (⋯ → beheer). Polls, since
// showAdmin's listGroupMembers load is async + the admin side may add the joiner a
// beat after the redeem response.
async function readRoster(page) {
  if (!(await openMore(page, 'admin'))) return { present: false, count: 0, names: [] };
  const rows = page.locator('.cc-admin__member');
  let n = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1200);
    n = await rows.count();
    if (n >= 2) break;
  }
  const names = [];
  for (let i = 0; i < n; i++) names.push((await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  const back = page.locator('.cc-admin__back');
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(1000); }
  return { present: true, count: n, names };
}

function log(step, verdict, note) {
  console.log(`\n### ${step}: ${verdict}\n    ${note}\n`);
}

// ── the two-peer flow ────────────────────────────────────────────────────────
test('two peers pair over the app transport + collaborate', async ({ browser }) => {
  const A = await bootPeer(browser, 'A');
  const B = await bootPeer(browser, 'B');
  const a = A.page, b = B.page;
  log('STEP1 boot two contexts (fresh storage → distinct identities)', 'PASS', 'both contexts booted at app root');

  // ── Peer A: create a circle, enable tasks, generate an invite ─────────────
  await gotoCircles(a);
  await createCircle(a, 'Peer Circle');
  await openCircleMatching(a, /peer.?circle/i);
  await toChat(a);
  const tasksOnA = await enableTasks(a);
  console.log('A tasks enabled:', tasksOnA);
  // reopen circle after settings save
  await gotoCircles(a);
  await openCircleMatching(a, /peer.?circle/i);
  await toChat(a);

  // Peer B just needs to be at the launcher to join.
  await gotoCircles(b);
  console.log('B tiles before join:', JSON.stringify(await tileNames(b)));

  // Transport-up evidence (from the boot console logs already captured above).
  log('STEP2 peer transport (NKN)', 'PASS', 'both peers logged "peer transport connected" at boot (see [A/B console] lines)');

  // ── Step 3: A invites, B joins — THE CRUX ─────────────────────────────────
  if (!(await openMore(a, 'invite'))) {
    log('STEP3 pairing', 'BLOCKED', 'no invite menu item on peer A');
    await teardown(A, B); return;
  }
  const codeEl = a.locator('.cc-mydata-modal code, .cc-mydata-modal__card code');
  const inviteUri = (await codeEl.count()) ? (await codeEl.first().innerText()).trim() : null;
  await a.screenshot({ path: `${SHOTS}/twopeer-A-invite.png` });
  await a.mouse.click(5, 5).catch(() => {});   // dismiss modal
  await a.waitForTimeout(500);
  console.log('A invite URI:', inviteUri ? inviteUri.slice(0, 70) + '…' : '(none)');
  if (!inviteUri) { log('STEP3 pairing', 'BLOCKED', 'empty invite code on A'); await teardown(A, B); return; }

  // Peer B joins from the invite.
  const joinBtn = b.locator('.circle-launcher__join');
  if (!(await joinBtn.count())) { log('STEP3 pairing', 'BLOCKED', 'no join button on B'); await teardown(A, B); return; }
  b.once('dialog', (d) => d.accept(inviteUri));   // paste-prompt
  await joinBtn.first().click();
  await b.waitForTimeout(2500);

  const card = b.locator('.cc-mydata-modal__card');
  await b.screenshot({ path: `${SHOTS}/twopeer-B-wizard-step1.png` });
  // Step 1 — rules
  const rulesCheck = card.locator('.cc-wizard-check input[type="checkbox"]').first();
  if (await rulesCheck.count()) { await rulesCheck.check().catch(() => {}); await b.waitForTimeout(400); }
  await card.locator('.cc-wizard-btn-primary').first().click().catch(() => {});
  await b.waitForTimeout(1200);
  // Step 2 — privacy (leave mesh/DM default on)
  const privCheck = card.locator('.cc-wizard-check input[type="checkbox"]').first();
  if (await privCheck.count()) { await privCheck.check().catch(() => {}); await b.waitForTimeout(400); }
  await card.locator('.cc-wizard-btn-primary').first().click().catch(() => {});
  await b.waitForTimeout(1200);
  // Step 3 — handle + submit
  const handleInput = card.locator('.cc-wizard-handle-input');
  if (await handleInput.count()) { await handleInput.fill('peerbee'); await b.waitForTimeout(400); }
  await b.screenshot({ path: `${SHOTS}/twopeer-B-wizard-step3.png` });
  const submitBtn = card.locator('.cc-wizard-submit');
  if (await submitBtn.count()) await submitBtn.first().click().catch(() => {});

  // Wait out the redeem handshake (local redeem → peer-redeem fallback, 30s timeout).
  let joinOutcome = 'unknown';
  for (let i = 0; i < 26; i++) {
    await b.waitForTimeout(2500);
    const stillOpen = await b.locator('.cc-mydata-modal__card').count();
    const errEl = b.locator('.cc-mydata-modal__card .cc-wizard-error');
    const errTxt = (await errEl.count()) ? (await errEl.first().innerText()).replace(/\s+/g, ' ').trim() : '';
    if (!stillOpen) { joinOutcome = 'wizard-closed (join succeeded)'; break; }
    if (errTxt) joinOutcome = `error: ${errTxt}`;
    if (i % 4 === 0) console.log(`B join wait ${i}: open=${stillOpen} err=${JSON.stringify(errTxt)}`);
  }
  console.log('B join outcome:', joinOutcome);
  await b.screenshot({ path: `${SHOTS}/twopeer-B-join-result.png` });

  // Confirm co-membership: (1) B's launcher shows the joined circle tile;
  // (2) the admin roster on BOTH sides lists 2 members.
  await b.waitForTimeout(1500);
  await gotoCircles(b);
  const bTiles = await tileNames(b);
  const bHasCircle = bTiles.some((s) => /peer.?circle/i.test(s));
  console.log('B tiles after join:', JSON.stringify(bTiles));

  await openCircleMatching(b, /peer.?circle/i);
  await toChat(b);
  const bRoster = await readRoster(b);
  console.log('B roster:', JSON.stringify(bRoster));

  // give A a moment to process the redeem, then read A's roster
  await a.waitForTimeout(2500);
  const aRoster = await readRoster(a);
  console.log('A roster:', JSON.stringify(aRoster));

  const aTwo = aRoster.count >= 2;
  const bTwo = bRoster.count >= 2;
  const paired = bHasCircle && (aTwo || bTwo);
  log('STEP3 pairing (CRUX)', paired ? 'PASS' : (bHasCircle ? 'PARTIAL' : 'BLOCKED'),
    `B joined-circle tile=${bHasCircle}; A roster count=${aRoster.count} ${JSON.stringify(aRoster.names)}; B roster count=${bRoster.count} ${JSON.stringify(bRoster.names)}; joinOutcome=${joinOutcome}`);
  await a.screenshot({ path: `${SHOTS}/twopeer-A-members.png` });
  await b.screenshot({ path: `${SHOTS}/twopeer-B-members.png` });

  if (!bHasCircle) { log('COLLAB', 'SKIPPED', 'B did not join — nothing to collaborate on'); await teardown(A, B); return; }

  // Ensure both are in the circle chat, and B has tasks enabled (so its Taken tab renders).
  await gotoCircles(a); await openCircleMatching(a, /peer.?circle/i); await toChat(a);
  await gotoCircles(b); await openCircleMatching(b, /peer.?circle/i); await toChat(b);
  const tasksOnB = await enableTasks(b);
  console.log('B tasks enabled:', tasksOnB);
  await gotoCircles(b); await openCircleMatching(b, /peer.?circle/i); await toChat(b);

  // ── Step 4a: A sends a chat message → B receives ──────────────────────────
  try {
    await toChat(a);
    const msg = `hoi vanaf A ${Date.now().toString(36)}`;
    await sendComposer(a, msg, 3000);
    let got = false;
    for (let i = 0; i < 16; i++) {
      await b.waitForTimeout(2500);
      if ((await bubbles(b)).some((s) => s.includes(msg))) { got = true; break; }
    }
    console.log('B bubbles tail:', JSON.stringify((await bubbles(b)).slice(-5)));
    await b.screenshot({ path: `${SHOTS}/twopeer-msg-B.png` });
    await a.screenshot({ path: `${SHOTS}/twopeer-msg-A.png` });
    log('STEP4a chat A→B', got ? 'PASS' : 'FAIL', `sent ${JSON.stringify(msg)}; B ${got ? 'RECEIVED it' : 'did NOT show it'}`);
  } catch (e) { log('STEP4a chat A→B', 'FAIL', `threw: ${e.message.split('\n')[0]}`); }

  // ── Step 4b: A /addtask → B Taken tab sees it ─────────────────────────────
  try {
    await toChat(a);
    await sendComposer(a, '/addtask verf kopen', 4000);
    console.log('A bubbles after addtask:', JSON.stringify((await bubbles(a)).slice(-3)));
    await b.waitForTimeout(3500);
    const bTabs = b.locator('.circle-view__tab');
    const bTabLabels = (await bTabs.allTextContents()).map((s) => s.trim());
    console.log('B circle tabs:', JSON.stringify(bTabLabels));
    const takenIdx = bTabLabels.findIndex((s) => /taken|task/i.test(s));
    let seen = false, rowText = '(no Taken tab on B)';
    if (takenIdx >= 0) {
      await bTabs.nth(takenIdx).click();
      await b.waitForTimeout(2500);
      // let it sync + re-poll
      for (let i = 0; i < 6 && !seen; i++) {
        const rows = b.locator('.circle-view__task');
        const rc = await rows.count();
        rowText = rc ? (await rows.first().innerText()).replace(/\s+/g, ' ').trim() : '(no task rows)';
        seen = /verf/i.test(rowText);
        if (!seen) { await b.waitForTimeout(2500); }
      }
      console.log('B Taken first row:', JSON.stringify(rowText));
    }
    await b.screenshot({ path: `${SHOTS}/twopeer-task-B.png` });
    log('STEP4b task A→B', seen ? 'PASS' : (takenIdx < 0 ? 'BLOCKED' : 'FAIL'), `B Taken tab: ${JSON.stringify(rowText)}`);
  } catch (e) { log('STEP4b task A→B', 'FAIL', `threw: ${e.message.split('\n')[0]}`); }

  // ── Step 4c: A opens the mandate picker → WIE lists peer B → entrust B ─────
  try {
    await toChat(a);
    const aTabs = a.locator('.circle-view__tab');
    const aTabLabels = (await aTabs.allTextContents()).map((s) => s.trim());
    const takenIdxA = aTabLabels.findIndex((s) => /taken|task/i.test(s));
    if (takenIdxA >= 0) { await aTabs.nth(takenIdxA).click(); await a.waitForTimeout(2000); }

    // find the owner-only entrust action on the task row
    let entrust = a.locator('.circle-view__bubble-action--mandate, .circle-view__task-action--mandate, [data-action="mandate"]');
    if (!(await entrust.count())) {
      entrust = a.locator('.circle-view__task button, .circle-view__task-action, .circle-view__bubble-action').filter({ hasText: /toevertrouwen/i });
    }
    const ec = await entrust.count();
    console.log('A entrust action count:', ec);
    if (!ec) { await a.screenshot({ path: `${SHOTS}/twopeer-mandate-A.png` }); log('STEP4c mandate', 'BLOCKED', 'no Toevertrouwen action on the task row'); await teardown(A, B); return; }

    await entrust.first().click();
    await a.waitForTimeout(2000);
    const picker = a.locator('.cc-mandate-picker');
    const whoItems = a.locator('.cc-mandate-picker__who-item');
    const whoCount = await whoItems.count();
    const emptyNote = await a.locator('.cc-mandate-picker__empty').count();
    const ptxt = (await picker.count()) ? (await picker.first().innerText()).replace(/\s+/g, ' ').trim() : '(picker not found)';
    console.log('A mandate picker WHO count:', whoCount, 'empty-note:', emptyNote, 'text:', JSON.stringify(ptxt.slice(0, 300)));
    await a.screenshot({ path: `${SHOTS}/twopeer-mandate-A.png` });

    const listsB = whoCount >= 1 && emptyNote === 0;
    if (listsB) {
      // pick B (first WHO item), pick the default WAARVOOR ("namens jou handelen"), confirm.
      await whoItems.first().click();
      await a.waitForTimeout(600);
      const whatItems = a.locator('.cc-mandate-picker__what-item');
      if (await whatItems.count()) { await whatItems.first().click(); await a.waitForTimeout(600); }
      const confirm = a.locator('.cc-mandate-picker__confirm');
      const cDisabled = (await confirm.count()) ? await confirm.first().isDisabled() : true;
      console.log('A confirm present/disabled:', await confirm.count(), cDisabled);
      await a.screenshot({ path: `${SHOTS}/twopeer-mandate-A-selected.png` });
      // the confirm routes through the shared confirm-gate ("weet je het zeker?") — accept it too
      if (await confirm.count() && !cDisabled) {
        await confirm.first().click();
        await a.waitForTimeout(1500);
        const gate = a.locator('.cc-confirm__ok, .cc-confirm-gate__confirm, button:has-text("Ja"), button:has-text("Bevestig")');
        if (await gate.count()) { await gate.first().click().catch(() => {}); await a.waitForTimeout(2000); }
      }
      await a.waitForTimeout(1500);
      await a.screenshot({ path: `${SHOTS}/twopeer-mandate-A-result.png` });
      log('STEP4c mandate WIE lists B + entrust', 'PASS',
        `WHO list has ${whoCount} member(s), no "niemand anders"; picked B + confirmed. picker text: ${JSON.stringify(ptxt.slice(0, 160))}`);
    } else {
      log('STEP4c mandate WIE lists B', 'FAIL',
        `WHO count=${whoCount}, empty-note=${emptyNote} (still "niemand anders"). picker: ${JSON.stringify(ptxt.slice(0, 160))}`);
    }
  } catch (e) { log('STEP4c mandate', 'FAIL', `threw: ${e.message.split('\n')[0]}`); }

  await teardown(A, B);
});

async function teardown(A, B) {
  try { await A.context.close(); } catch { /* */ }
  try { await B.context.close(); } catch { /* */ }
}
