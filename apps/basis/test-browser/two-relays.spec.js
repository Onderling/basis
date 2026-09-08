/**
 * Two relays (2026-09-08): a person on their OWN relay joins a circle that rides ANOTHER one — and stays
 * reachable in it after a reload. This is how a self-hoster tests their network: invite from their box,
 * have someone on the default relay join.
 *
 * Arm with two local relays (the fixture starts both):
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8791 PEER_TEST_RELAY_2=ws://127.0.0.1:8792 \
 *     npx playwright test --project=relay test-browser/two-relays.spec.js
 *
 * What it proves, read from the app: B's primary stays its own relay, the circle's relay comes BESIDE it
 * (the join used to swap), a message crosses both ways, and after B reloads the extra relay is dialled
 * again from the recorded connection point — so the circle keeps working, not only during the join.
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, waitForBubble, reopenCircle, toChat, gotoCircles, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
const R2 = process.env.PEER_TEST_RELAY_2 || '';

test.skip(!R1 || !R2, 'needs PEER_TEST_RELAY and PEER_TEST_RELAY_2');

const relaysOf = (page) => page.evaluate(() => (window.onderlingRelays ? window.onderlingRelays() : []));

/**
 * Send in the open circle, and SAY WHICH BRANCH failed when it cannot. A bare `sendChat` timing out on the
 * composer reports "element not found", which is true of a closed circle, a modal over it and a tab with no
 * composer alike — three different bugs wearing one message.
 */
async function sendInCircle(page, text) {
  const input = page.locator('.circle-view__composer-input');
  try {
    await input.first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    const seen = await page.evaluate(() => ({
      inCircle: !!document.querySelector('.circle-view'),
      activeTab: document.querySelector('.circle-view__body')?.dataset?.activeTab ?? null,
      modal: !!document.querySelector('.cc-mydata-modal'),
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 240),
    }));
    throw new Error(`no composer to send into — ${JSON.stringify(seen)}`);
  }
  await input.first().fill(text);
  await page.locator('.circle-view__composer-send').first().click();
  await page.waitForTimeout(3000);
}

/**
 * Contacten → the first PERSON (never a bot) → type → send. Returns the contact it sent to, or a reason.
 * Picking `.cc-contacts__row` blindly picks whatever sorted first — a bot, on a device that has one — and
 * the DM then goes somewhere no assertion is looking.
 */
async function sendDirectMessage(page, text) {
  await gotoCircles(page);
  const tab = page.locator('[data-tab="contacten"]');
  if (!(await tab.count())) return { sent: false, why: 'no Contacten tab' };
  await tab.first().click();
  await page.waitForTimeout(2000);
  const rows = page.locator('.cc-contacts__row:not(.cc-contacts__row--bot)');
  if (!(await rows.count())) {
    const all = await page.locator('.cc-contacts__row').count();
    return { sent: false, why: `no person to write to (${all} row(s), all bots)` };
  }
  const to = await rows.first().getAttribute('data-contact-id');
  await rows.first().click();
  await page.waitForTimeout(2000);
  const input = page.locator('.cc-cthread__input');
  if (!(await input.count())) return { sent: false, why: `thread for ${to} did not open` };
  await input.first().fill(text);
  await page.locator('.cc-cthread__send').first().click();
  await page.waitForTimeout(2500);
  return { sent: true, to };
}

/** Poll the other side's contact threads until the text shows up in one. */
async function waitForContactMessage(page, text, { tries = 10, every = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    await gotoCircles(page);
    const tab = page.locator('[data-tab="contacten"]');
    if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(1500); }
    const rows = page.locator('.cc-contacts__row');
    for (let r = 0; r < await rows.count(); r++) {
      await rows.nth(r).click();
      await page.waitForTimeout(1500);
      const log_ = await page.evaluate(() => document.querySelector('.cc-cthread__log')?.innerText ?? '');
      if (log_.includes(text)) return true;
      const back = page.locator('.cc-cthread__back, .circle-view__back');
      if (await back.count()) { await back.first().click(); await page.waitForTimeout(800); }
    }
    await page.waitForTimeout(every);
  }
  return false;
}

async function waitForRelays(page, pred, { tries = 20, every = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const list = await relaysOf(page);
    if (pred(list)) return list;
    await page.waitForTimeout(every);
  }
  return relaysOf(page);
}

test('a joiner on its own relay comes beside the circle relay, and is still there after a reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const A = await bootPeer(browser, 'A', { transportMode: 'relay', relayUrl: R1 });
  const B = await bootPeer(browser, 'B', { transportMode: 'relay', relayUrl: R2 });
  try {
    expect((await waitForRelays(A.page, (l) => l.some((r) => r.connected))).map((r) => r.url)).toEqual([R1]);
    expect((await waitForRelays(B.page, (l) => l.some((r) => r.connected))).map((r) => r.url)).toEqual([R2]);
    log('STEP1 boot', 'PASS', `A on ${R1}, B on ${R2}`);

    const { joined, joinerHasTile, outcome } = await pair(A, B, { name: 'Twee relays', re: /twee.?relays/i, handle: 'bram' });
    expect(joined, `join outcome: ${outcome}`).toBe(true);
    expect(joinerHasTile).toBe(true);
    const bRelays = await waitForRelays(B.page, (l) => l.length === 2 && l.every((r) => r.connected));
    expect(bRelays.map((r) => [r.url, r.primary])).toEqual([[R2, true], [R1, false]]);
    log('STEP2 join across relays', 'PASS', `B is on ${bRelays.map((r) => r.url).join(' + ')}; primary unchanged`);

    // A → B, and B → A, over the circle's relay (R1) — B's alias for this circle lives there only.
    await reopenCircle(B.page, /twee.?relays/i); await toChat(B.page);
    await reopenCircle(A.page, /twee.?relays/i); await toChat(A.page);
    await sendInCircle(A.page, 'hallo over relay één');
    expect(await waitForBubble(B.page, 'hallo over relay één')).toBe(true);
    await sendInCircle(B.page, 'terug vanaf relay twee');
    expect(await waitForBubble(A.page, 'terug vanaf relay twee')).toBe(true);
    log('STEP3 messages cross', 'PASS', 'both directions');

    // A DIRECT message, the other way round: B is on relay 2, A is on relay 1 only, and a DM carries no
    // circle. Until 2026-09-08 that meant "this device's own relay" — B would have sent it to relay 2,
    // where A is not registered, and with NKN off in this run it would simply never arrive. B knows which
    // kringen it shares with A, and this one rides relay 1, so that is where the DM goes.
    const dm = 'een dm over de andere relay';
    const sent = await sendDirectMessage(B.page, dm);
    expect(sent.sent, `B could not write to A: ${sent.why ?? ''}`).toBe(true);
    expect(await waitForContactMessage(A.page, dm), `a DM to ${sent.to} crossed no relay A is on`).toBe(true);
    log('STEP4 a direct message', 'PASS', `B → A (${String(sent.to).slice(0, 12)}…) over the kring’s relay, not over B’s own`);

    // B reloads: the extra relay must come back from the recorded connection point, not from the join.
    await B.page.reload();
    await B.page.waitForTimeout(4000);
    const after = await waitForRelays(B.page, (l) => l.length === 2 && l.every((r) => r.connected), { tries: 40 });
    expect(after.map((r) => [r.url, r.primary])).toEqual([[R2, true], [R1, false]]);
    await reopenCircle(B.page, /twee.?relays/i); await toChat(B.page);
    // Both sides are still standing in a contact thread from the DM leg — this step is about the kring.
    await reopenCircle(A.page, /twee.?relays/i); await toChat(A.page);
    await sendInCircle(A.page, 'na de herstart');
    expect(await waitForBubble(B.page, 'na de herstart')).toBe(true);
    log('STEP5 after reload', 'PASS', 'extra relay redialled from the connection point; message arrived');
  } finally {
    await teardown([A, B]);
  }
});
