/**
 * WHAT ONE DEVICE DOES, THE PERSON'S OTHER DEVICE FOLLOWS — the marks of 2026-09-24, on real browser bytes.
 *
 * One person on two web apps (A1, and A2 enrolled from it by the add-a-device ceremony), and a contact B, over a
 * local relay. Every change is made on A1 and read on A2; nothing on A2 is touched except to look:
 *
 *   opbergen  the put-away mark rides the circle-follow carry → A2's launcher folds the circle; taken out, it is back
 *   L125      a contact added on A1 through the sheet arrives on A2 with its persona and level; a later change follows
 *   L114      a delete on A1 → A2's row is hidden with the deletion on record, and A2 leaves the pair circle too
 *
 * The unit tests pin the carries; this is the walk that crosses the real relay between two real devices.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-own-devices-follow.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, createCircle, log, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const myCircles = async (page) => ((await call(page, 'stoop', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
const bookRow = async (page, webid) => ((await call(page, 'stoop', 'listContacts', {}))?.contacts ?? []).find((c) => c.webid === webid) ?? null;
const hasPair = async (page) => (await myCircles(page)).some((id) => String(id).startsWith('pair-'));
async function nameMe(page, name) {
  await page.locator('[data-tab="mij"]').first().click(); await page.waitForTimeout(1200);
  await page.locator('.cc-profile__display').fill(name); await page.locator('.cc-profile__save').click(); await page.waitForTimeout(1500);
}
async function openThread(page, contactId) {
  await gotoCircles(page);
  await page.locator('[data-tab="contacten"]').first().click(); await page.waitForTimeout(1500);
  await page.locator(`.cc-contacts__row[data-contact-id="${contactId}"]`).first().click();
  await page.waitForTimeout(1500);
}
/** Where a circle sits on a launcher: 'list', 'fold', or null. Repaints the launcher first. */
async function launcherPlace(page, circleId) {
  await gotoCircles(page);
  if (await page.locator(`.circle-launcher__list--folded [data-circle-id="${circleId}"]`).count()) return 'fold';
  if (await page.locator(`.circle-launcher__list [data-circle-id="${circleId}"]`).count()) return 'list';
  return null;
}

test('one person, two devices: the put-away mark, the contact lens and a delete follow to the other device', async ({ browser }) => {
  test.setTimeout(600_000);
  let A1 = null; let A2 = null; let B = null;
  try {
    // ── A1 with a circle; A2 enrolled from it (they talk to each other in the circle they share) ───────────
    A1 = await bootPeer(browser, 'A1');
    for (const p of [A1]) p.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(A1.page); await nameMe(A1.page, 'Anna'); await gotoCircles(A1.page);
    const before = new Set(await myCircles(A1.page));
    await createCircle(A1.page, 'Thuis');
    await expect.poll(async () => (await myCircles(A1.page)).find((id) => !before.has(id)) ?? null, { timeout: 30_000 }).toBeTruthy();
    const thuis = (await myCircles(A1.page)).find((id) => !before.has(id));
    const aId = (await call(A1.page, 'stoop', 'whoAmI'))?.webid;

    A2 = await bootPeer(browser, 'A2');
    A2.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(A2.page);
    const offer = await call(A1.page, 'household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await call(A1.page, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
    const enrolled = await A2.page.evaluate(async ([uri, words]) => {
      localStorage.setItem('onderling.enrollOffer', uri);
      return window.onderlingCall('household', 'enrollDevice', { mnemonic: words, label: 'walk-own-devices' });
    }, [offer.uri, phrase]);
    expect(enrolled?.ok, JSON.stringify(enrolled)).toBe(true);
    await A2.page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => A2.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await myCircles(A2.page)).includes(thuis), { timeout: 90_000, message: 'A2 is in Thuis' }).toBe(true);
    expect((await call(A2.page, 'stoop', 'whoAmI'))?.webid, 'A2 is the same person').toBe(aId);
    log('SETUP A2 enrolled', 'PASS', `Thuis ${String(thuis).slice(0, 10)}…`);

    // ── 1. OPBERGEN: put away on A1 → folded on A2 ───────────────────────────────────────────────────
    await gotoCircles(A1.page);
    await A1.page.locator(`.circle-launcher__list [data-circle-id="${thuis}"]`).first().click({ button: 'right' });
    await A1.page.locator('.circle-launcher__tile-menu [data-action="put-away"]').click();
    expect(await launcherPlace(A1.page, thuis), 'folded on A1').toBe('fold');
    await expect.poll(() => launcherPlace(A2.page, thuis), { timeout: 60_000, message: 'the mark reached A2: folded there too' }).toBe('fold');
    log('STEP1 opbergen follows', 'PASS', 'A1 → A2');

    // ── 2. L125: a contact added on A1 through the sheet arrives on A2 with its lens ─────────────────────
    B = await bootPeer(browser, 'B');
    B.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(B.page); await nameMe(B.page, 'Bea');
    const bId = (await call(B.page, 'stoop', 'whoAmI'))?.webid;
    await B.page.locator('[data-tab="mij"]').first().click(); await B.page.waitForTimeout(1200);
    await B.page.locator('.cc-profile__share-contact').click();
    const link = await B.page.locator('.cc-share__link input').inputValue();
    await gotoCircles(B.page);
    const dest = `${new URL(A1.page.url()).pathname}${new URL(A1.page.url()).search}${link.slice(link.indexOf('#'))}`;
    await A1.page.goto('about:blank'); await A1.page.goto(dest);
    await expect(A1.page.locator('[data-testid="contact-add-sheet"]'), 'A1 is asked first').toBeVisible({ timeout: 30_000 });
    await A1.page.locator('.cc-lens__level').selectOption('handle');
    await A1.page.locator('.cc-lens__ok').click();
    await expect.poll(async () => (await bookRow(A1.page, bId))?.revealPreset ?? null, { timeout: 20_000 }).toBe('handle');
    await expect.poll(async () => { const r = await bookRow(A2.page, bId); return r ? `${r.persona}/${r.revealPreset}` : null; },
      { timeout: 60_000, message: 'B arrives on A2 with the lens A1 chose' }).toBe('default/handle');
    log('STEP2 the lens follows the new contact', 'PASS', 'default/handle on A2');

    // A1 writes (A1 added B; B learns A from the first message), so the pair circle exists — on A1, and on A2 by the
    // follow carry
    const hi = `hoi Bea ${Date.now().toString(36)}`;
    const sent = await sendDirectMessage(A1.page, hi, { to: bId });
    expect(sent.sent, `A1 could not write: ${sent.why}`).toBe(true);
    await waitForContactMessageDetailed(B.page, hi);
    await expect.poll(() => hasPair(A1.page), { timeout: 60_000, message: 'A1 holds the pair circle' }).toBe(true);
    await expect.poll(() => hasPair(A2.page), { timeout: 90_000, message: 'A2 follows into the pair circle' }).toBe(true);

    // ── 3. L125: the level changed later on A1 → A2 follows ────────────────────────────────────────────
    await openThread(A1.page, bId);
    await A1.page.locator('.cc-cthread__lens').click();
    await A1.page.locator('.cc-lens__level').selectOption('full');
    await A1.page.locator('.cc-lens__ok').click();
    await expect.poll(async () => (await bookRow(A2.page, bId))?.revealPreset ?? null, { timeout: 60_000, message: 'the change reached A2' }).toBe('full');
    log('STEP3 a lens change follows', 'PASS', 'handle → full on A2');

    // ── 4. L114: delete on A1 → hidden with the deletion on record on A2, and A2 left the pair circle ───
    await openThread(A1.page, bId);
    await A1.page.locator('.cc-cthread__delete').click();
    await A1.page.locator('.cc-confirm__accept').click();
    await expect.poll(async () => { const r = await bookRow(A2.page, bId); return r ? { hidden: r.hidden, deleted: Number.isFinite(r.deletedAt) } : null; },
      { timeout: 60_000, message: 'the delete reached A2' }).toEqual({ hidden: true, deleted: true });
    await expect.poll(() => hasPair(A2.page), { timeout: 60_000, message: 'A2 left the pair circle with A1' }).toBe(false);
    log('STEP4 a delete follows', 'PASS', 'hidden + deletedAt + left on A2');

    // ── 5. OPBERGEN: taken out on A1 → back in A2's list ───────────────────────────────────────────────
    await gotoCircles(A1.page);
    await A1.page.locator('.circle-launcher__fold-title').click();
    await A1.page.locator(`.circle-launcher__list--folded [data-circle-id="${thuis}"]`).click({ button: 'right' });
    await A1.page.locator('.circle-launcher__tile-menu [data-action="put-away"]').click();
    await expect.poll(() => launcherPlace(A2.page, thuis), { timeout: 60_000, message: 'taken out on A2 too' }).toBe('list');
    log('STEP5 taking out follows', 'PASS', '');
  } finally {
    await teardown([A1, A2, B].filter(Boolean));
  }
});
