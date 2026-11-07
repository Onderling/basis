/**
 * A FILE TO A CONTACT FROM THE THREAD'S "+", AS A PERSON SENDS ONE.
 *
 * Two web apps over a local relay, contacts. A opens the thread with B from Contacten, taps the composer's "+", picks
 * "File" and chooses a file in the real chooser. Before, the only door was the `/send-file` slash. What must hold:
 * the file lands in B's thread; A's own thread shows it as A's side; and A's screen never shows B's key.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-contact-thread-attach.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, log, gotoCircles } from './peerHarness.js';
import { nameMe, becomeContacts } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

// a small real PNG (1×1, green)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('a file sent from a contact thread\'s + lands in theirs and shows in mine', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    await nameMe(A.page, 'Anna'); await nameMe(B.page, 'Bea');
    const { aId, bId } = await becomeContacts(A, B);

    // A opens the thread with B the way a person does: Contacten → the row
    await gotoCircles(A.page);
    await A.page.locator('[data-tab="contacten"]').first().click();
    await A.page.locator(`.cc-contacts__row[data-contact-id="${bId}"]`).first().click();
    await expect(A.page.locator('.cc-cthread')).toBeVisible({ timeout: 20_000 });

    // the composer's "+", then the File entry, then the real chooser
    await A.page.locator('.cc-cthread__attach').first().click();
    const fileEntry = A.page.locator('.cc-cthread__attach-item', { hasText: /^File$|^Bestand$/ }).first();
    await expect(fileEntry, 'the + offers a file').toBeVisible({ timeout: 10_000 });
    const alerts = [];
    A.page.on('dialog', (d) => { alerts.push(d.message()); d.dismiss().catch(() => {}); });
    const chooser = A.page.waitForEvent('filechooser', { timeout: 20_000 });
    await fileEntry.click();
    await (await chooser).setFiles({ name: 'plant.png', mimeType: 'image/png', buffer: PNG });
    log('STEP1 A picked a file through the thread\'s +', 'PASS');

    // A's own thread shows it, as A's side
    await expect(A.page.locator('.cc-cthread__msg--user .cc-cthread__bubble--file'), 'the sent file shows in my thread')
      .toHaveCount(1, { timeout: 30_000 });
    log('STEP2 the sent file is in A\'s own thread', 'PASS');

    // B received it
    const landed = async () => B.page.evaluate(async (id) => {
      try {
        const rows = await window.onderlingContactChannel?.rehydrate?.(id);
        const f = (rows ?? []).map((x) => x?.file).find(Boolean);
        return f ? { name: f.name, mime: f.mime } : null;
      } catch { return null; }
    }, aId);
    await expect.poll(landed, { timeout: 60_000, message: 'the file landed in B\'s thread' }).toBeTruthy();
    expect((await landed()).name).toBe('plant.png');
    log('STEP3 B has the file', 'PASS');

    // and nothing put B's key on A's screen
    const KEYISH = /[A-Za-z0-9_-]{28,}/;   // an address or key: a long unbroken token no sentence has
    for (const a of alerts) expect(a, 'an alert carried a key').not.toMatch(KEYISH);
    expect(await A.page.locator('.cc-cthread').innerText(), 'the thread shows a key').not.toMatch(KEYISH);
    log('STEP4 no key on A\'s screen', 'PASS', `alerts: ${alerts.length}`);
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
