/**
 * THE PERSON KEY — a device you revoke can no longer read what your contacts send you.
 *
 * Direct messages are sealed to the recipient's PERSON key (versioned, rotating). Revoking a device runs the ceremony
 * that moves the person to the next version, so a message sealed after it opens on the devices you kept and not on
 * the one you revoked. The relay test pins the ceremony (`personKeyRotation`, `personKeyContacts`); this is the browser
 * twin of the two-phone walk (binding-levels §10.7).
 *
 * Three web apps over a local relay: A, and B on two devices (B1 the laptop, B2 enrolled from it). A and B are
 * contacts. B1 revokes B2 → B1 writes A (sealed from version 2, so A pulls the chain) → A's contact row for B shows
 * version 2 → A writes B → B1 reads it, B2 does not.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-person-key.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';
import { call, nameMe, becomeContacts, whoAmI } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const contactKey = async (page, webid) => ((((r) => r?.contacts ?? r?.items ?? [])(await call(page, 'stoop', 'listContacts', {})))
  .find((c) => c.webid === webid)?.personKey ?? null);
/** Does this device hold a turn with `text` in its thread with `contactId`? The DURABLE thread, not the screen — so
 *  "does not" means it never arrived readable, not that the pane was closed. */
const holdsTurn = (page, text, contactId) => page.evaluate(async ([needle, id]) => {
  try {
    const rows = await window.onderlingContactChannel?.rehydrate?.(id);
    return Array.isArray(rows) && rows.some((r) => String(r?.text ?? '').includes(needle));
  } catch { return false; }
}, [text, contactId]);

test('B revokes a device: A\'s next message to B is sealed to the new version — B\'s kept device reads it, the revoked one does not', async ({ browser }) => {
  test.setTimeout(720_000);
  let A = null; let B1 = null; let B2 = null;
  try {
    A = await bootPeer(browser, 'A'); B1 = await bootPeer(browser, 'B1');
    for (const peer of [A, B1]) peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await nameMe(A.page, 'Anna'); await nameMe(B1.page, 'Bea');
    const { aId, bId } = await becomeContacts(A, B1);

    // B2 — enrolled from B1 (an add, by the offer), follows into the pair circle
    B2 = await bootPeer(browser, 'B2');
    B2.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await gotoCircles(B2.page);
    const offer = await call(B1.page, 'household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await call(B1.page, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
    const enrolled = await B2.page.evaluate(async ([uri, words]) => {
      localStorage.setItem('onderling.enrollOffer', uri);
      return window.onderlingCall('household', 'enrollDevice', { mnemonic: words, label: 'walk-person-key' });
    }, [offer.uri, phrase]);
    expect(enrolled?.ok && enrolled.deviceId, JSON.stringify(enrolled)).toBeTruthy();
    await B2.page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => B2.page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => whoAmI(B2.page), { timeout: 90_000, message: 'B2 is B (the enrol consumed)' }).toBe(bId);
    await expect.poll(async () => (await contactKey(A.page, bId))?.version ?? null, { timeout: 60_000, message: 'A holds B\'s person key' }).toBe(1);
    // before the revoke, B2 reads what A sends — the baseline, so "does not" below means something
    const before = `voor ${Date.now().toString(36)}`;
    expect((await sendDirectMessage(A.page, before, { to: bId })).sent).toBe(true);
    await expect.poll(() => holdsTurn(B2.page, before, aId), { timeout: 60_000, message: 'B2 reads A before the revoke' }).toBe(true);
    log('SETUP A + B on two devices, contacts, B2 reads', 'PASS', `B2 = ${String(enrolled.deviceId).slice(0, 10)}…`);

    // B1 revokes B2
    const circles = ((await call(B1.page, 'stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
    const revoked = await call(B1.page, 'household', 'revokeDevice', { mnemonic: phrase, deviceId: enrolled.deviceId, circleIds: circles });
    expect(revoked?.ok, JSON.stringify(revoked).slice(0, 300)).toBe(true);
    log('STEP1 B1 revoked B2', 'PASS', '');

    // B1 writes A — sealed from version 2 — so A learns the new version
    const hi = `nieuwe sleutel ${Date.now().toString(36)}`;
    expect((await sendDirectMessage(B1.page, hi, { to: aId })).sent).toBe(true);
    await waitForContactMessageDetailed(A.page, hi);
    await expect.poll(async () => (await contactKey(A.page, bId))?.version ?? null, { timeout: 60_000, message: 'A\'s row for B shows version 2' }).toBe(2);
    log('STEP2 A holds version 2', 'PASS', '');

    // A writes B: sealed to version 2 → B1 reads, B2 does not
    const after = `na ${Date.now().toString(36)}`;
    expect((await sendDirectMessage(A.page, after, { to: bId })).sent).toBe(true);
    await expect.poll(() => holdsTurn(B1.page, after, aId), { timeout: 60_000, message: 'B1 reads A\'s message' }).toBe(true);
    await B2.page.waitForTimeout(15_000);   // give B2 every chance a live device would have
    expect(await holdsTurn(B2.page, after, aId), 'B2 — revoked — cannot read it').toBe(false);
    log('STEP3 kept device reads, revoked one does not', 'PASS', '');
  } finally {
    await teardown([A, B1, B2].filter(Boolean));
  }
});
