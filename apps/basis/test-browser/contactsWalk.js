/**
 * Contacts, the way a person makes one — for the walks that need two people to BE contacts (a pair circle between
 * them), not just co-members. B shares their contact link from Mij; A opens it, answers the add sheet, and writes
 * B once — the first message forms the pair circle on both sides.
 */
import { expect } from '@playwright/test';
import { gotoCircles, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';

export const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
export const circleIds = async (page) => ((await call(page, 'pinboard', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
export const whoAmI = async (page) => (await call(page, 'pinboard', 'whoAmI'))?.webid ?? null;

/** Name this app's person under Mij (the display name field + save). */
export async function nameMe(page, name) {
  await gotoCircles(page);
  await page.locator('[data-tab="mij"]').first().click(); await page.waitForTimeout(1200);
  await page.locator('.circle-screen__identity-edit').click(); await page.locator('.cc-profile__display').fill(name);
  await page.locator('.cc-profile__save').click(); await page.waitForTimeout(1500); await page.locator('.cc-screen-panel__close').click();
  await gotoCircles(page);
}

/** The pair circle between two people, as `page` holds it (null until formed). */
export async function pairCircleWith(page, otherWebid) {
  const ids = (await circleIds(page)).filter((id) => String(id).startsWith('pair-'));
  if (!otherWebid || ids.length <= 1) return ids[0] ?? null;
  for (const id of ids) {
    const members = (await call(page, 'pinboard', 'listGroupMembers', { groupId: id }))?.members ?? [];
    if (members.some((m) => m.webid === otherWebid)) return id;
  }
  return null;
}

/**
 * `opener` opens `sharer`'s contact link (Mij → share my contact) and answers the add sheet: `sharer` is in their book.
 */
export async function addByLink(sharer, opener, { level = null } = {}) {
  await gotoCircles(sharer.page);
  await sharer.page.locator('[data-tab="mij"]').first().click(); await sharer.page.waitForTimeout(1200);
  await sharer.page.locator('.cc-profile__share-contact').click();
  const link = await sharer.page.locator('.cc-share__link input').inputValue();
  await gotoCircles(sharer.page);
  const dest = `${new URL(opener.page.url()).pathname}${new URL(opener.page.url()).search}${link.slice(link.indexOf('#'))}`;
  await opener.page.goto('about:blank'); await opener.page.goto(dest);
  await expect(opener.page.locator('[data-testid="contact-add-sheet"]'), 'the opener is asked first').toBeVisible({ timeout: 30_000 });
  if (level) await opener.page.locator('.cc-lens__level').selectOption(level);
  await opener.page.locator('.cc-lens__ok').click();
}

/**
 * A and B become contacts the way two people who both chose each other do: each opens the other's link (a first message
 * from someone not chosen is a request since 2026-11-12, so a one-sided add would make A's first message a request on
 * B's side; the walks that use this are about what follows, not about that door). Then A writes once and both hold the
 * pair circle.
 * @returns {Promise<{aId: string, bId: string, pairId: string}>}
 */
export async function becomeContacts(A, B, { level = null } = {}) {
  const aId = await whoAmI(A.page); const bId = await whoAmI(B.page);
  await addByLink(B, A, { level });   // A chooses B
  await addByLink(A, B);              // B chooses A
  await gotoCircles(A.page);
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
