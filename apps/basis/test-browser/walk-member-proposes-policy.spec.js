/**
 * A MEMBER PROPOSES A CIRCLE-SETTINGS CHANGE; AN ADMIN ACCEPTS IT. A member's own statement of the policy is dropped by
 * every device, so their Save is a proposal ("Stel voor"): the governance `changePolicy` action, signed as their self in
 * the circle, carrying only what they changed. The admin is asked on their own settings screen, takes it over, and the
 * change is the circle's — on the member's device too.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-member-proposes-policy.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, pair, openMore, openCircleMatching, log } from './peerHarness.js';
import { circleIds } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_PORT + PEER_TEST_RELAY');

/** In the circle's own view (where ⋯ is): open it from the list unless already there. */
const inCircle = async (page) => { if (!(await page.locator('.circle-view__more').count())) await openCircleMatching(page, /voorstel/i); };

const featureOn = (page, circleId, f) => page.evaluate(async ({ cid, f }) => {
  try { const p = await window.onderlingCirclePolicy?.get(cid); return p?.features?.[f] === true; } catch { return null; }
}, { cid: circleId, f });

test('a member\'s Save is a proposal; the admin\'s yes makes it the circle\'s', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    const p = await pair(A, B, { name: 'Voorstel', re: /voorstel/i, handle: 'bea' });
    expect(p.joined, `B joined: ${p.outcome}`).toBe(true);
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));

    // B (a member): the settings' Save says "propose"; flip one feature and propose it
    await inCircle(B.page);
    expect(await openMore(B.page, 'settings')).toBe(true);
    const save = B.page.locator('.circle-settings__save');
    await expect(save).toHaveAttribute('data-propose', 'true', { timeout: 30_000 });
    // a plain feature (chat is derived from the circle's conversation kinds, not stored as itself)
    const box = B.page.locator('input[data-feature]:not([data-feature="chat"])').first();
    const feature = await box.getAttribute('data-feature');
    const was = await box.isChecked();
    if (was) await box.uncheck(); else await box.check();
    await save.click();
    log('STEP1 the member proposed', 'PASS', `${feature}: ${was} → ${!was}`);
    expect(await featureOn(B.page, circle, feature), 'a proposal changes nothing yet').toBe(was);

    // A (the admin): the proposal is answered on A's own settings screen, under the fields — "Bea stelt voor: … · Overnemen"
    await inCircle(A.page);
    await expect.poll(async () => {
      if (await A.page.locator('.circle-settings__back').count()) await A.page.locator('.circle-settings__back').first().click();
      await A.page.waitForTimeout(500);
      await inCircle(A.page);
      await openMore(A.page, 'settings');
      return A.page.locator('.circle-settings__proposal-yes').count();
    }, { timeout: 150_000, intervals: [5_000], message: 'the admin is asked to answer the member\'s proposal' }).toBeGreaterThan(0);
    await expect(A.page.locator('.circle-settings__proposal-text')).toContainText(/stelt voor|proposes/);
    await A.page.locator('.circle-settings__proposal-yes').first().click();
    await expect.poll(() => featureOn(A.page, circle, feature), { timeout: 30_000 }).toBe(!was);
    log('STEP2 the admin accepted', 'PASS', '');

    // …and the circle's policy reaches the member
    await expect.poll(() => featureOn(B.page, circle, feature), { timeout: 120_000, message: 'the member holds the accepted change' }).toBe(!was);
    log('STEP3 the member holds it', 'PASS', '');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
