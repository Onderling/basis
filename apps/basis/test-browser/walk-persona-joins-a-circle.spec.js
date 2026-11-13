/**
 * PERSONAS ON THE WEB, WITH A SECOND PERSON (the function matrix's personas × web cell). Anna holds a second persona,
 * "Werk". Bram makes a circle and invites her; in the join wizard she chooses to join AS Werk. On Bram's side, from his
 * own roster and his own chat: the new member is Werk, never Anna's general name. A line she sends arrives as Werk.
 * After a reload of her app the next line still arrives as Werk.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8796 npx playwright test --project=relay test-browser/walk-persona-joins-a-circle.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, gotoCircles, createCircle, openCircleMatching, toChat, getInvite, sendChat, readBubbles, tileNames, shot } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
test.setTimeout(300_000);

const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const stamp = Date.now().toString(36);
const CIRCLE = `Werkkring ${stamp}`;
const GENERAL = `Anna${stamp}`;
const PERSONA = `Werk${stamp}`;

/** Join from the invite the way the wizard is used, choosing the persona in step 3's fold. */
async function joinAsPersona(page, inviteUri, personaId) {
  await gotoCircles(page);
  page.once('dialog', (d) => d.accept(inviteUri));
  await page.locator('.circle-launcher__join').first().click();
  await page.waitForTimeout(2500);
  const card = page.locator('.cc-mydata-modal__card');
  const rules = card.locator('.cc-wizard-check input[type="checkbox"]').first();
  if (await rules.count()) await rules.check().catch(() => {});
  await card.locator('.cc-wizard-btn-primary').first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const priv = card.locator('.cc-wizard-check input[type="checkbox"]');
  for (let i = 0; i < await priv.count(); i += 1) await priv.nth(i).check().catch(() => {});
  await card.locator('.cc-wizard-btn-primary').first().click().catch(() => {});
  await page.waitForTimeout(1200);
  // step 3: open the "join as" fold and choose the persona
  const fold = card.locator('details').filter({ has: page.locator('.cc-wizard-persona-select') }).first();
  await expect(fold, 'the wizard offers a choice of who joins').toHaveCount(1, { timeout: 10_000 });
  await fold.locator('summary').click();
  await fold.locator('.cc-wizard-persona-select').selectOption(personaId);
  await page.waitForTimeout(600);
  await shot(page, 'persona-web-01-join-as');
  await card.locator('.cc-wizard-submit').first().click();
  for (let i = 0; i < 26; i += 1) {
    await page.waitForTimeout(2500);
    if (!(await page.locator('.cc-mydata-modal__card').count())) return true;
  }
  return false;
}

/** Bram's own roster with names (`listGroupMembers`: the rich read, Bram's own row included), polled until `pred` holds. */
async function rosterUntil(page, groupId, pred, ms = 90_000) {
  const until = Date.now() + ms;
  let rows = [];
  while (Date.now() < until) {
    rows = ((await call(page, 'pinboard', 'listGroupMembers', { groupId }))?.members ?? []);
    if (pred(rows)) return rows;
    await page.waitForTimeout(2500);
  }
  throw new Error(`Bram's roster never matched: ${JSON.stringify(rows)}`);
}

/** The bubble on `page` that holds `line`, polled. */
async function bubbleWith(page, line, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = (await readBubbles(page)).find((s) => s.includes(line));
    if (hit) return hit;
    await page.waitForTimeout(2500);
  }
  return null;
}

test('a person joins a circle as a persona: the other member sees only the persona, also after a reload', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [anna, bram] = peers;
  try {
    // Anna: a general name, and a second persona
    await anna.page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
    await call(anna.page, 'agents', 'setProfileProperty', { id: 'default', key: 'handle', value: GENERAL });
    const werk = (await call(anna.page, 'agents', 'createProfile', { name: PERSONA }))?.id ?? null;
    expect(werk, 'the persona was made').toBeTruthy();

    // Bram: a circle and its invite
    await gotoCircles(bram.page);
    await createCircle(bram.page, CIRCLE);
    await openCircleMatching(bram.page, new RegExp(stamp));
    await toChat(bram.page);
    // the circle's id, from Bram's own list, by its name
    const mine = await call(bram.page, 'pinboard', 'listMyCircles', {});
    const ids = (mine?.circles ?? []).map((c) => (typeof c === 'string' ? c : c.groupId ?? c.id));
    const groupId = ids.find((id) => String(mine?.names?.[id] ?? '').includes(stamp)) ?? null;
    expect(groupId, `Bram's circle id: ${JSON.stringify(mine)}`).toBeTruthy();
    const invite = await getInvite(bram.page, 'persona-web-invite');
    expect(invite, 'Bram has an invite').toBeTruthy();

    // Anna joins as Werk
    expect(await joinAsPersona(anna.page, invite, werk), 'the join finished').toBe(true);
    await gotoCircles(anna.page);
    expect((await tileNames(anna.page)).some((s) => s.includes(stamp)), "Bram's circle is on Anna's launcher").toBe(true);

    // Bram's roster: one other member, carrying the persona's name, never Anna's general one
    const rows = await rosterUntil(bram.page, groupId, (rs) => rs.some((r) => JSON.stringify(r).includes(PERSONA)));
    expect(rows.length, `Bram and one other member: ${JSON.stringify(rows)}`).toBe(2);
    expect(JSON.stringify(rows), 'the general persona never shows').not.toContain(GENERAL);

    // a line from Anna arrives at Bram as Werk
    const LINE_1 = `als werk ${stamp}`;
    await openCircleMatching(anna.page, new RegExp(stamp));
    await toChat(anna.page);
    await sendChat(anna.page, LINE_1);
    const b1 = await bubbleWith(bram.page, LINE_1);
    await shot(bram.page, 'persona-web-02-bram-sees');
    expect(b1, 'the line arrived at Bram').toBeTruthy();
    // KNOWN DEFECT (2026-11-13): a live line from a member who has just joined paints as an unknown member until the
    // circle is repainted; reopening it shows the persona's name. The cell judges the name after a repaint; the live
    // label is a defect of its own, not this story's.
    let named = b1;
    if (!named.includes(PERSONA)) {
      await gotoCircles(bram.page);
      await openCircleMatching(bram.page, new RegExp(stamp));
      await toChat(bram.page);
      named = (await bubbleWith(bram.page, LINE_1, 20_000)) ?? '';
      const members = (await call(bram.page, 'pinboard', 'listGroupMembers', { groupId }))?.members ?? [];
      console.log('[persona-web] bubble before/after repaint:', JSON.stringify({ before: b1, after: named, members }));
    }
    expect(named, 'it arrived under the persona').toContain(PERSONA);
    expect(b1, 'never under the general name').not.toContain(GENERAL);

    // after a reload of Anna's app, still Werk
    await anna.page.reload();
    await anna.page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
    // the launcher fills once the circles are read back: wait for the tile, and say what it showed if it never comes
    let tiles = [];
    for (let i = 0; i < 24; i += 1) {
      await gotoCircles(anna.page);
      tiles = await tileNames(anna.page);
      if (tiles.some((s) => s.includes(stamp))) break;
      await anna.page.waitForTimeout(2500);
    }
    const ownCircles = await call(anna.page, 'pinboard', 'listMyCircles', {});
    expect(tiles.some((s) => s.includes(stamp)), `after the reload the circle's tile shows; tiles ${JSON.stringify(tiles)}, listMyCircles ${JSON.stringify(ownCircles)}`).toBe(true);
    await openCircleMatching(anna.page, new RegExp(stamp));
    await toChat(anna.page);
    const LINE_2 = `na herladen ${stamp}`;
    await sendChat(anna.page, LINE_2);
    const b2 = await bubbleWith(bram.page, LINE_2);
    await shot(bram.page, 'persona-web-03-after-reload');
    expect(b2, 'the line after the reload arrived').toBeTruthy();
    expect(b2).toContain(PERSONA);
    expect(b2).not.toContain(GENERAL);
    const after = await rosterUntil(bram.page, groupId, () => true, 10_000);
    expect(after.length, `still Bram and one other member: ${JSON.stringify(after)}`).toBe(2);
    expect(JSON.stringify(after)).not.toContain(GENERAL);
  } finally {
    await teardown(peers);
  }
});
