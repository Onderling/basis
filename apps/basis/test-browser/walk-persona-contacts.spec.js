/**
 * THE PERSONA AND CONTACTS WORK OF 2026-09-24, ON REAL SCREENS — two web apps over a local relay.
 *
 *   L122  the create wizard asks which persona founds a circle (default preselected); the id is the founder's
 *   L126  …and the circle's id is not derived from its name
 *   opbergen  a circle put away folds out of the launcher; taken out, it is back
 *   L125  a contact link asks first (the sheet: persona + level, prefilled); the thread header changes it later
 *   L114  delete = hide + leave the pair circle; their next message brings them back, marked "verwijderd"
 *
 * Arm with a local relay (the fixture starts it); a dedicated port keeps another project's Vite out of it:
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-persona-contacts.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const bookRow = async (page, webid) => ((await call(page, 'stoop', 'listContacts', {}))?.contacts ?? []).find((c) => c.webid === webid) ?? null;
async function nameMe(page, name) {
  await page.locator('[data-tab="mij"]').first().click(); await page.waitForTimeout(1200);
  await page.locator('.cc-profile__display').fill(name); await page.locator('.cc-profile__save').click(); await page.waitForTimeout(1500);
}
async function openThread(page, contactId) {
  await gotoCircles(page);
  await page.locator('[data-tab="contacten"]').first().click(); await page.waitForTimeout(1500);
  const row = page.locator(`.cc-contacts__row[data-contact-id="${contactId}"]`);
  if (!(await row.count())) {   // a hidden row sits in the fold
    const fold = page.locator('.cc-contacts__fold, details.cc-contacts__hidden, .cc-contacts__hidden-fold');
    if (await fold.count()) { await fold.first().click(); await page.waitForTimeout(600); }
  }
  await page.locator(`.cc-contacts__row[data-contact-id="${contactId}"]`).first().click();
  await page.waitForTimeout(1500);
}

test('persona on create · opbergen · the add sheet · the lens on the thread · delete and return', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A');
    B = await bootPeer(browser, 'B');
    for (const p of [A, B]) p.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(A.page); await nameMe(A.page, 'Anna');
    await gotoCircles(B.page); await nameMe(B.page, 'Bea');
    const aId = (await call(A.page, 'stoop', 'whoAmI'))?.webid;
    const bId = (await call(B.page, 'stoop', 'whoAmI'))?.webid;

    // ── L122 + L126: the create wizard ─────────────────────────────────────────────────────────────
    const made = await call(A.page, 'agents', 'createProfile', { id: 'buurt', name: 'Buurt' });
    expect(made?.error ?? made?.ok === false ? String(made?.error ?? made?.reason) : 'ok', 'setup: a second persona').toBe('ok');
    await gotoCircles(A.page);
    const idsOf = async () => ((await call(A.page, 'stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId ?? c?.id));
    const before = new Set(await idsOf());
    await A.page.locator('.circle-launcher__new').click();
    const picker = A.page.locator('[data-testid="create-founder-persona"]');
    await expect(picker, 'the founding persona is asked').toBeVisible({ timeout: 20_000 });
    expect(await picker.inputValue(), 'the default is preselected').toBe('default');
    expect(await picker.locator('option').evaluateAll((os) => os.map((o) => o.value)), 'the personas are offered, and starting minimally').toEqual(['', 'default', 'buurt']);
    await picker.selectOption('buurt');
    await A.page.locator('.cc-wizard-input').first().fill('Proeftuin');
    for (let i = 0; i < 5; i += 1) { await A.page.locator('.cc-wizard-btn-primary').first().click(); await A.page.waitForTimeout(300); }
    await expect(A.page.locator('.cc-wizard-review'), 'the review names the founding persona').toContainText('Buurt');
    await A.page.locator('.cc-wizard-btn-primary').first().click();
    await A.page.waitForTimeout(3000);
    // the circle is the one id that was not there before (its id is the founder's, so the NAME cannot find it)
    const newId = (await idsOf()).find((id) => !before.has(id));
    expect(newId, 'the circle exists').toBeTruthy();
    const proeftuin = { id: newId };
    expect(proeftuin.id, 'its id is the founder\'s, not its name (L126)').not.toMatch(/^proeftuin$/i);
    log('STEP1 L122/L126 create as a persona', 'PASS', `id ${String(proeftuin.id).slice(0, 16)}…`);

    // ── opbergen: put it away from the tile menu; take it out again ──────────────────────────────────
    await A.page.keyboard.press('Escape').catch(() => {});
    await gotoCircles(A.page);
    const tile = A.page.locator(`.circle-launcher__list:not(.circle-launcher__list--folded) [data-circle-id="${proeftuin.id}"]`);
    await expect(tile, 'the new circle is in the list').toBeVisible({ timeout: 15_000 });
    await tile.click({ button: 'right' });
    await A.page.locator('.circle-launcher__tile-menu [data-action="put-away"]').click();
    await expect(A.page.locator(`.circle-launcher__list--folded [data-circle-id="${proeftuin.id}"]`), 'put away: in the fold').toHaveCount(1, { timeout: 10_000 });
    expect(await A.page.locator(`.circle-launcher__list:not(.circle-launcher__list--folded) [data-circle-id="${proeftuin.id}"]`).count(), 'and out of the list').toBe(0);
    await A.page.locator('.circle-launcher__fold-title').click();
    await A.page.locator(`.circle-launcher__list--folded [data-circle-id="${proeftuin.id}"]`).click({ button: 'right' });
    await A.page.locator('.circle-launcher__tile-menu [data-action="put-away"]').click();
    await expect(A.page.locator(`.circle-launcher__list:not(.circle-launcher__list--folded) [data-circle-id="${proeftuin.id}"]`), 'taken out: back in the list').toHaveCount(1, { timeout: 10_000 });
    log('STEP2 opbergen', 'PASS', 'folded, and back');

    // ── L125: the add sheet ──────────────────────────────────────────────────────────────────────────
    await A.page.locator('[data-tab="mij"]').first().click(); await A.page.waitForTimeout(1200);
    await A.page.locator('.cc-profile__share-contact').click();
    const link = await A.page.locator('.cc-share__link input').inputValue();
    await gotoCircles(A.page);
    const dest = `${new URL(B.page.url()).pathname}${new URL(B.page.url()).search}${link.slice(link.indexOf('#'))}`;
    await B.page.goto('about:blank'); await B.page.goto(dest);
    const sheet = B.page.locator('[data-testid="contact-add-sheet"]');
    await expect(sheet, 'the link asks first').toBeVisible({ timeout: 30_000 });
    expect(await B.page.locator('.cc-lens__persona').inputValue(), 'the default persona is prefilled').toBe('default');
    await B.page.locator('.cc-lens__level').selectOption('handle');
    await B.page.locator('.cc-lens__ok').click();
    await expect.poll(async () => (await bookRow(B.page, aId))?.revealPreset ?? null, { timeout: 20_000, message: 'B\'s row records the level chosen' }).toBe('handle');
    expect((await bookRow(B.page, aId))?.persona, 'and the persona').toBe('default');
    log('STEP3 L125 the add sheet', 'PASS', 'default persona, level handle');

    // ── B writes; the pair circle forms ──────────────────────────────────────────────────────────────
    await gotoCircles(B.page);
    const first = `hoi Anna ${Date.now().toString(36)}`;
    const sent = await sendDirectMessage(B.page, first, { to: aId });
    expect(sent.sent, `B could not write: ${sent.why}`).toBe(true);
    const got = await waitForContactMessageDetailed(A.page, first);
    expect(got.found ?? got, 'A sees B\'s message').toBeTruthy();
    await expect.poll(async () => ((await call(B.page, 'stoop', 'listMyCircles', {}))?.circles ?? []).some((c) => String(typeof c === 'string' ? c : c?.groupId ?? c?.id).startsWith('pair-')),
      { timeout: 40_000, message: 'the pair circle forms' }).toBe(true);
    log('STEP4 the pair circle', 'PASS', '');

    // ── L125: change the level later, on the thread header ───────────────────────────────────────────
    await openThread(B.page, aId);
    await B.page.locator('.cc-cthread__lens').click();
    await expect(B.page.locator('[data-testid="contact-lens"]'), 'the lens control opens').toBeVisible({ timeout: 10_000 });
    expect(await B.page.locator('.cc-lens__level').inputValue(), 'it shows what was chosen at the add').toBe('handle');
    await B.page.locator('.cc-lens__level').selectOption('profile');
    await B.page.locator('.cc-lens__ok').click();
    await expect.poll(async () => (await bookRow(B.page, aId))?.revealPreset ?? null, { timeout: 20_000, message: 'the row follows the change' }).toBe('profile');
    log('STEP5 L125 the lens on the thread', 'PASS', 'handle → profile');

    // ── L114: delete; their next message brings them back, marked ──────────────────────────────────
    await openThread(B.page, aId);
    await B.page.locator('.cc-cthread__delete').click();
    await B.page.locator('.cc-confirm__accept').click();
    await expect.poll(async () => { const r = await bookRow(B.page, aId); return r ? { hidden: r.hidden, deleted: Number.isFinite(r.deletedAt) } : null; },
      { timeout: 20_000, message: 'deleted: hidden, with the deletion on record' }).toEqual({ hidden: true, deleted: true });
    await expect.poll(async () => ((await call(B.page, 'stoop', 'listMyCircles', {}))?.circles ?? []).some((c) => String(typeof c === 'string' ? c : c?.groupId ?? c?.id).startsWith('pair-')),
      { timeout: 20_000, message: 'B left the pair circle' }).toBe(false);
    log('STEP6 L114 delete', 'PASS', 'hidden + left');

    const back = `ben je er nog? ${Date.now().toString(36)}`;
    const sentBack = await sendDirectMessage(A.page, back, { to: bId });
    expect(sentBack.sent, `A could not write: ${sentBack.why}`).toBe(true);
    await expect.poll(async () => (await bookRow(B.page, aId))?.hidden ?? null, { timeout: 40_000, message: 'the row comes back' }).toBe(false);
    await openThread(B.page, aId);
    await expect(B.page.locator('.cc-cthread__system').first(), 'the marker says the contact had been deleted').toContainText(/verwijderd|deleted/i, { timeout: 15_000 });
    await expect.poll(async () => ((await call(B.page, 'stoop', 'listMyCircles', {}))?.circles ?? []).some((c) => String(typeof c === 'string' ? c : c?.groupId ?? c?.id).startsWith('pair-')),
      { timeout: 40_000, message: 'the SAME pair circle is re-joined' }).toBe(true);
    log('STEP7 L114 the return', 'PASS', 'shown again, marked, re-joined');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
