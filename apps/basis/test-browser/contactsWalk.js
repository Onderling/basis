/**
 * Contacts, the way a person makes one — for the walks that need two people to BE contacts (a pair circle between
 * them), not just co-members. B shares their contact link from Mij; A opens it, answers the add sheet, and writes
 * B once — the first message forms the pair circle on both sides.
 */
import { expect } from '@playwright/test';
import { gotoCircles, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';

export const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
export const circleIds = async (page) => ((await call(page, 'stoop', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
export const whoAmI = async (page) => (await call(page, 'stoop', 'whoAmI'))?.webid ?? null;

/** Name this app's person under Mij (the display name field + save). */
export async function nameMe(page, name) {
  await gotoCircles(page);
  await page.locator('[data-tab="mij"]').first().click(); await page.waitForTimeout(1200);
  await page.locator('.cc-profile__display').fill(name);
  await page.locator('.cc-profile__save').click(); await page.waitForTimeout(1500);
  await gotoCircles(page);
}

/** The pair circle between two people, as `page` holds it (null until formed). */
export async function pairCircleWith(page, otherWebid) {
  const ids = (await circleIds(page)).filter((id) => String(id).startsWith('pair-'));
  if (!otherWebid || ids.length <= 1) return ids[0] ?? null;
  for (const id of ids) {
    const members = (await call(page, 'stoop', 'listGroupMembers', { groupId: id }))?.members ?? [];
    if (members.some((m) => m.webid === otherWebid)) return id;
  }
  return null;
}

/**
 * A adds B as a contact (B's link, the sheet, one message) and both hold the pair circle.
 * @returns {Promise<{aId: string, bId: string, pairId: string}>}
 */
export async function becomeContacts(A, B, { level = null } = {}) {
  const aId = await whoAmI(A.page); const bId = await whoAmI(B.page);
  await gotoCircles(B.page);
  await B.page.locator('[data-tab="mij"]').first().click(); await B.page.waitForTimeout(1200);
  await B.page.locator('.cc-profile__share-contact').click();
  const link = await B.page.locator('.cc-share__link input').inputValue();
  await gotoCircles(B.page);
  const dest = `${new URL(A.page.url()).pathname}${new URL(A.page.url()).search}${link.slice(link.indexOf('#'))}`;
  await A.page.goto('about:blank'); await A.page.goto(dest);
  await expect(A.page.locator('[data-testid="contact-add-sheet"]'), 'A is asked first').toBeVisible({ timeout: 30_000 });
  if (level) await A.page.locator('.cc-lens__level').selectOption(level);
  await A.page.locator('.cc-lens__ok').click();
  const hi = `hoi ${Date.now().toString(36)}`;
  const sent = await sendDirectMessage(A.page, hi, { to: bId });
  expect(sent.sent, `A could not write: ${sent.why}`).toBe(true);
  await waitForContactMessageDetailed(B.page, hi);
  await expect.poll(() => pairCircleWith(A.page, bId), { timeout: 60_000, message: 'A holds the pair circle' }).toBeTruthy();
  await expect.poll(() => pairCircleWith(B.page, aId), { timeout: 60_000, message: 'B holds the pair circle' }).toBeTruthy();
  return { aId, bId, pairId: await pairCircleWith(A.page, bId) };
}

/** A's Contacten row for `webid`, as painted: name · lookalike tell · was-line (null when absent). */
export async function contactRow(page, webid) {
  await gotoCircles(page);
  await page.locator('[data-tab="contacten"]').first().click(); await page.waitForTimeout(1500);
  const row = page.locator(`.cc-contacts__row[data-contact-id="${webid}"]`).first();
  if (!(await row.count())) return null;
  return row.evaluate((el) => {
    const nameEl = el.querySelector('.cc-contacts__name');
    const tell = el.querySelector('.cc-contacts__lookalike')?.textContent ?? null;
    const name = nameEl ? [...nameEl.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() : null;
    return { name, tell, was: el.querySelector('.cc-contacts__was')?.textContent ?? null };
  });
}
