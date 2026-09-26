/**
 * THE FACE TRAVELS AND IS PAINTED — a picture set under Mij reaches the people it was shown to, and is drawn where
 * they look for that person.
 *
 * Two web apps over a local relay.
 *
 *   IN A CIRCLE   B picks a picture under Mij (the real file input), discloses it to a circle A is in and presses
 *                 "share". On A: the roster row carries the sealed picture (the release landed) → the members-tab
 *                 row and the member card draw it → B withdraws it → the members-tab row is back to the initial.
 *   TO A CONTACT  the same picture, shown to A as a contact (the pair circle is the contact's disclosure context)
 *                 → A's Contacten row draws it. KNOWN TO FAIL: there is no road for it yet — the pair circle is not
 *                 in Mij's table and the contact lens's levels release no picture. Marked `test.fail`, so it turns
 *                 red the day the road exists and the mark comes off.
 *
 * TODAY (the third test, passing): a picture disclosed to such a circle says on its Mij row that it cannot go there,
 * and a share says it went without the picture — the honest line until the arc lands (then that test fails on purpose).
 *
 * BOTH HALVES ARE MARKED `test.fail` TODAY. The circle half stops at "the release landed": in a circle with no pod
 * (`pod: 'none'`, the default policy) the shell has no seal strategy for the circle (`getCircleSealStrategy` comes
 * from `ensureCirclePod`'s control agent), so there is no media composition, the re-seal returns null, the picture
 * is DROPPED from the outbound release, the writer finds nothing changed — and Mij still says "Gedeeld ✓". Probed
 * 2026-09-25: `prod: true, control: false, sealing: false`. A key question (how a pod-less circle seals media) —
 * Fable's, on the ledger. The paint half of the fix is pinned at the renderer level meanwhile.
 *
 * Found by this walk (2026-09-25), besides that, all three invisible to the unit tests: the waist refused every picture
 * (`setProfileProperty` declared `value` a string; Mij swallowed the refusal); the members tab, the Contacten row and
 * the thread header were never handed the circle's opener, so a face could not be drawn anywhere but the member card;
 * and the shared face decision did not read the `face` key a Contacten row carries.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-face.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, pair, log, openCircleMatching, openLedenTab } from './peerHarness.js';
import { becomeContacts } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const circleIds = async (page) => ((await call(page, 'stoop', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
const rosterRow = async (page, circleId, webid) => ((await call(page, 'stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? [])
  .find((m) => m.webid === webid) ?? null;
const hasSealedPicture = (row) => {
  const p = row?.personaProperties?.profilePicture ?? row?.said?.personaProperties?.profilePicture;
  return !!(p && typeof p === 'object' && p.enc);
};

async function closePanel(page) {
  const x = page.locator('.cc-screen-panel__close');
  while (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
  await gotoCircles(page);
}
/** Open Mij's persona panel (the picture input and the per-circle table live there). */
async function openPersonaPanel(page) {
  await closePanel(page);
  await page.locator('[data-tab="mij"]').first().click(); await page.waitForTimeout(1500);
  await page.locator('.cc-profile__offerings-moved-link').first().click(); await page.waitForTimeout(2000);
}
/** Press this circle's share / stop-sharing button in Mij's table. Names the branch it took. */
async function pressShareFor(page, circleId) {
  await openPersonaPanel(page);
  const rows = page.locator(`.cc-mij__table tr[data-circle-id="${circleId}"]`);
  if (!(await rows.count())) {
    const listed = await page.locator('.cc-mij__table tr[data-circle-id]').evaluateAll((els) => [...new Set(els.map((e) => e.dataset.circleId))]);
    await closePanel(page);
    return { pressed: false, why: `no row for ${String(circleId).slice(0, 14)}… in Mij's table (rows: ${listed.map((x) => String(x).slice(0, 14)).join(', ')})` };
  }
  const btn = rows.locator('.cc-mij__cell-action button').first();
  if (!(await btn.count())) { await closePanel(page); return { pressed: false, why: 'the row offers no share button' }; }
  await btn.click();
  const status = rows.locator('.cc-mij__share-status').first();
  await expect.poll(() => status.textContent(), { timeout: 30_000 }).toMatch(/gedeeld|shared|gestopt|stopped|fout|failed/i);
  const text = (await status.textContent())?.trim();
  await closePanel(page);
  return { pressed: true, status: text };
}
/** Pick a picture through the real input; the persona holds it. */
async function setPicture(page) {
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 96; c.height = 96;
    const g = c.getContext('2d'); g.fillStyle = '#c0392b'; g.fillRect(0, 0, 96, 96); g.fillStyle = '#fff'; g.fillRect(24, 24, 48, 48);
    return c.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await openPersonaPanel(page);
  const input = page.locator('.cc-mij__picture-input');
  if (!(await input.count())) throw new Error('Mij offers no picture input (the host did not wire the seam)');
  await input.setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => {
    const v = (await call(page, 'agents', 'getProfileProperties', { id: 'default' }).catch(() => null))?.properties?.profilePicture;
    return !!(v && (v.value ?? v));
  }, { timeout: 30_000, message: 'the persona holds the picture' }).toBe(true);
  await closePanel(page);
}
/** A face slot: 'img' (drawn) · 'initial' (a letter) · 'empty' · 'none' (no slot at all). */
const slotState = (locator) => locator.evaluate((el) => {
  const img = el.querySelector('img');
  if (img && img.getAttribute('src')) return 'img';
  return (el.textContent || '').trim() ? 'initial' : 'empty';
}).catch(() => 'none');

test('in a circle: a face set under Mij and shared is drawn on the members tab and the member card; withdrawn, the initial returns', async ({ browser }) => {
  // KNOWN TO FAIL — a pod-less circle cannot seal the picture for its members (see the file header). Remove the mark
  // when it passes.
  test.fail();
  test.setTimeout(480_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Gezichten', re: /gezichten/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    // pair() answers its own dialogs; from here on none is expected — dismiss rather than hang on one
    for (const peer of [A, B]) peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const bId = (await call(B.page, 'stoop', 'whoAmI'))?.webid;
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    expect(circle, 'the shared circle').toBeTruthy();

    await setPicture(B.page);
    log('STEP1 B set a picture', 'PASS', '');

    await call(B.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: circle, key: 'profilePicture', enabled: true });
    const s = await pressShareFor(B.page, circle);
    expect(s.pressed, `share: ${s.why ?? ''}`).toBe(true);
    const landed = await expect.poll(async () => hasSealedPicture(await rosterRow(A.page, circle, bId)), { timeout: 60_000 }).toBe(true).then(() => true, () => false);
    if (!landed) {
      const row = await rosterRow(A.page, circle, bId);
      const own = await rosterRow(B.page, circle, bId);
      const pp = (r) => JSON.stringify({ props: r?.personaProperties ?? null, said: r?.said?.personaProperties ?? null }).slice(0, 400);
      const rel = await call(B.page, 'agents', 'getPersonaRelease', { id: 'default', contextId: circle }).catch((e) => ({ error: String(e) }));
      const relShape = JSON.stringify(rel, (k, v) => (typeof v === 'string' && v.length > 40 ? `${v.slice(0, 20)}…(${v.length})` : v)).slice(0, 500);
      throw new Error(`the picture did not land on A's row for B (share said "${s.status}") — A sees ${pp(row)} · B's own row ${pp(own)} · B's release ${relShape}`);
    }
    log('STEP2 shared, and it landed', 'PASS', s.status);

    await gotoCircles(A.page);
    await openCircleMatching(A.page, /gezichten/i);
    const tab = await openLedenTab(A.page);
    expect(tab.present, `A has a members tab: ${JSON.stringify(tab.labels)}`).toBe(true);
    const memberRow = A.page.locator(`.circle-view__member[data-member-id="${bId}"]`).first();
    await expect(memberRow, 'B is on A\'s members tab').toBeVisible({ timeout: 30_000 });
    await expect.poll(() => slotState(memberRow.locator('.circle-view__member-face').first()), { timeout: 20_000, message: 'the members-tab row draws B\'s face' }).toBe('img');
    log('STEP3a members tab', 'PASS', '');

    await memberRow.click();
    const cardPic = A.page.locator('.circle-membercard__attr-pic').first();
    await expect(cardPic, 'the member card lists the picture').toBeVisible({ timeout: 20_000 });
    await expect.poll(() => cardPic.getAttribute('src'), { timeout: 20_000, message: 'the member card draws it' }).toBeTruthy();
    log('STEP3b member card', 'PASS', '');

    await call(B.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: circle, key: 'profilePicture', enabled: false });
    const w = await pressShareFor(B.page, circle);
    expect(w.pressed, `withdraw: ${w.why ?? ''}`).toBe(true);
    await expect.poll(async () => hasSealedPicture(await rosterRow(A.page, circle, bId)), { timeout: 60_000, message: 'the withdrawal landed' }).toBe(false);
    await gotoCircles(A.page);
    await openCircleMatching(A.page, /gezichten/i);
    await openLedenTab(A.page);
    await expect.poll(() => slotState(A.page.locator(`.circle-view__member[data-member-id="${bId}"] .circle-view__member-face`).first()), { timeout: 20_000, message: 'the initial is back' }).toBe('initial');
    log('STEP4 withdrawn → the initial', 'PASS', w.status);
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});

test('to a contact: the face shown to a contact is drawn on their Contacten row', async ({ browser }) => {
  // KNOWN TO FAIL — no road to show a picture to a contact yet (see the file header). Remove the mark when it passes.
  test.fail();
  test.setTimeout(480_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    for (const peer of [A, B]) peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(A.page); await gotoCircles(B.page);
    const bId = (await call(B.page, 'stoop', 'whoAmI'))?.webid;
    const { pairId } = await becomeContacts(A, B);

    await setPicture(B.page);
    await call(B.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: pairId, key: 'profilePicture', enabled: true });
    const s = await pressShareFor(B.page, pairId);
    log('STEP contact share', s.pressed ? 'PASS' : 'KNOWN GAP', s.pressed ? s.status : s.why);
    expect(s.pressed, `share to the contact: ${s.why ?? ''}`).toBe(true);

    await gotoCircles(A.page);
    await A.page.locator('[data-tab="contacten"]').first().click(); await A.page.waitForTimeout(1500);
    const icon = A.page.locator(`.cc-contacts__row[data-contact-id="${bId}"] .cc-contacts__icon`).first();
    await expect.poll(() => slotState(icon), { timeout: 60_000, message: 'the Contacten row draws B\'s face' }).toBe('img');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});

test('today, in a circle that cannot carry a picture: its Mij row says so, and a share says it left it out', async ({ browser }) => {
  // The honest line while a pod-less circle cannot seal media (Fable's ruling on L140: the arc comes after the testers).
  // When that arc lands this test FAILS — the picture will travel — and it is rewritten with the halves above.
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Eerlijk', re: /eerlijk/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    for (const peer of [A, B]) peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const circle = (await circleIds(B.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    await setPicture(B.page);
    await call(B.page, 'agents', 'setProfileDisclosure', { id: 'default', contextId: circle, key: 'profilePicture', enabled: true });

    // the row for the disclosed picture says it cannot go here
    await openPersonaPanel(B.page);
    const note = B.page.locator(`.cc-mij__table tr[data-circle-id="${circle}"][data-key="profilePicture"] .cc-mij__not-here`).first();
    await expect(note, 'the picture row says why').toHaveText(/geen foto's dragen|cannot carry pictures/i, { timeout: 20_000 });
    await closePanel(B.page);
    log('STEP1 the row says why', 'PASS', '');

    // shared anyway: the status says it went WITHOUT the picture — not "Gedeeld ✓"
    const s = await pressShareFor(B.page, circle);
    expect(s.pressed, s.why ?? '').toBe(true);
    expect(s.status, 'the share says what it left out').toMatch(/behalve je foto|except your picture/i);
    log('STEP2 the share is honest', 'PASS', s.status);
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
