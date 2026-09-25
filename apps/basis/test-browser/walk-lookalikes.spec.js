/**
 * LOOKALIKES — two contacts who call themselves the same thing are told apart on your Contacten list.
 *
 * A contact is named by what THEY say on the pair roster, so anyone can take another's name. Three web apps over a
 * local relay: B and C both call themselves "Frits"; A has both as contacts → each of A's two rows carries a tell
 * beside the name (the handle, else the key's tail), and the two tells differ. Then C renames to something else → the
 * collision is gone, the tells go with it (L116).
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-lookalikes.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, log } from './peerHarness.js';
import { nameMe, becomeContacts, contactRow } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('two contacts both named Frits: each row carries a different tell; a rename ends the collision', async ({ browser }) => {
  test.setTimeout(600_000);
  let A = null; let B = null; let C = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B'); C = await bootPeer(browser, 'C');
    for (const peer of [A, B, C]) peer.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await nameMe(A.page, 'Anna'); await nameMe(B.page, 'Frits'); await nameMe(C.page, 'Frits');
    const { bId } = await becomeContacts(A, B);
    const { bId: cId } = await becomeContacts(A, C);
    const both = async () => {
      const [b, c] = [await contactRow(A.page, bId), await contactRow(A.page, cId)];
      return (b?.name === 'Frits' && c?.name === 'Frits') ? { b, c } : null;
    };
    await expect.poll(both, { timeout: 60_000, message: 'both rows read "Frits"' }).toBeTruthy();
    log('SETUP two Frits', 'PASS', '');

    await expect.poll(async () => {
      const r = await both();
      return r && r.b.tell && r.c.tell && r.b.tell !== r.c.tell ? `${r.b.tell}|${r.c.tell}` : null;
    }, { timeout: 30_000, message: 'each row carries its own tell' }).toBeTruthy();
    const r = await both();
    log('STEP1 told apart', 'PASS', `${r.b.tell} · ${r.c.tell}`);

    await nameMe(C.page, 'Frits de Vries');
    await expect.poll(async () => (await contactRow(A.page, cId))?.name ?? null, { timeout: 60_000, message: 'C\'s rename reached A' }).toBe('Frits de Vries');
    await expect.poll(async () => (await contactRow(A.page, bId))?.tell ?? null, { timeout: 20_000, message: 'no collision → no tell on B\'s row' }).toBeNull();
    log('STEP2 collision gone', 'PASS', '');
  } finally {
    await teardown([A, B, C].filter(Boolean));
  }
});
