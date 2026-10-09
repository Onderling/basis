/**
 * Me → Scan on web (2026-10-09): no camera, so `scanQr`'s seam is the paste prompt; a pasted CONTACT CARD goes through
 * the route table to the declared `add-contact` flow, whose painter here is the lens sheet — "what will they see of
 * you" FIRST, never skipped. The card is the real-encoder fixture the mobile e2e uses.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-me-scan.spec.js
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootPeer, teardown, gotoCircles, log } from './peerHarness.js';

const CARD = JSON.parse(readFileSync(fileURLToPath(new URL('../../basis-mobile/e2e/support/contactCard.fixture.json', import.meta.url)), 'utf8'));
const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('Me → Scan: a pasted contact card lands in the "what will they see" sheet', async ({ browser }) => {
  test.setTimeout(180_000);
  let A = null;
  try {
    A = await bootPeer(browser, 'A');
    await gotoCircles(A.page);
    await A.page.locator('[data-tab="mij"]').first().click();
    await expect(A.page.locator('.cc-profile__scan')).toBeVisible({ timeout: 20_000 });
    log('STEP1 Me shows the declared actions', 'PASS', 'share-contact + scan');
    await expect(A.page.locator('.cc-profile__share-contact')).toBeVisible();
    A.page.once('dialog', (d) => d.accept(CARD.uri));   // the paste prompt (scanQr's seam on web)
    await A.page.locator('.cc-profile__scan').click();
    await expect(A.page.locator('.cc-lens').first()).toBeVisible({ timeout: 20_000 });
    log('STEP2 the card routed to add-contact → the lens sheet', 'PASS', 'asked first');
  } finally {
    await teardown([A].filter(Boolean));
  }
});
