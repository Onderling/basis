/**
 * START THIS DEVICE OVER FROM YOUR PHRASE — on real browser storage (ledger L1115, the review's section 3).
 *
 * The unit tests pin the order (startOver.test.js). What only a browser shows: what a real boot leaves on the origin,
 * whether the clear takes exactly Basis's part of it, whether the key door the phrase check opened can be deleted in
 * the same tab, and what a mark with no phrase does at a load.
 *
 *   1. THE REGISTER: after a real boot and a circle, every storage key and database on the origin is named by
 *      basisStorageNames.js. A store added under a new name fails here; otherwise it would survive a start-over,
 *      sealed under a key no longer there, and stop the next boot again.
 *   2. A MARK WITH NO PHRASE clears nothing: the load opens the phrase page; cancel removes the mark only.
 *   3. THE WAY OUT: the phrase checked, the confirm, the clear (the site's key and a screen page's pairing stay), the
 *      restore, a boot as the SAME person.
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, createCircle } from './peerHarness.js';
import { isBasisStorageKey, isBasisDatabase } from '../src/v2/basisStorageNames.js';

const call = (page, app, op, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall(a, o, g), [app, op, args]);
const MARK = 'cc-owner-root:start-over-pending';
const FOREIGN = { 'site-cookie-consent': 'yes', 'onderling-screen:test-grant': 'kept' };
// the phrase, once the agent answers: `{phrase}` or `{none: <what the call said>}` (a probe names its branch)
const phraseOf = async (page, timeout = 90_000) => {
  const t0 = Date.now(); let last = null;
  for (;;) {
    try { last = await call(page, 'household', 'revealOwnerPhrase', {}); if (last?.mnemonic) return { phrase: last.mnemonic }; } catch (e) { last = String(e?.message ?? e); }
    if (Date.now() - t0 > timeout) return { none: JSON.stringify(last)?.slice(0, 200) };
    await new Promise((r) => { setTimeout(r, 1000); });
  }
};
const storageNow = (page) => page.evaluate(async () => ({
  keys: Object.keys(window.localStorage),
  dbs: ((await indexedDB.databases?.()) ?? []).map((d) => d.name),
}));

test.describe('start this device over from your phrase', () => {
  test.setTimeout(180_000);
  let A = null;
  test.afterAll(async () => { await teardown([A].filter(Boolean)); });

  test('the register covers a real boot; a mark alone clears nothing; the phrase brings back the same person', async ({ browser }) => {
    A = await bootPeer(browser, 'A');
    await gotoCircles(A.page);
    await createCircle(A.page, `Start over ${Date.now().toString(36).slice(-4)}`);
    const { phrase } = await phraseOf(A.page);
    expect(phrase, 'the phrase can be read').toBeTruthy();
    // who this is, as the phrase derives it: after the restore the device boots in delegation custody and no longer holds
    // the phrase (by design), so "the same person" is the same webid, not a revealable phrase
    const who = (await call(A.page, 'pinboard', 'whoAmI', {}))?.webid;
    expect(who, 'the webid can be read').toBeTruthy();

    // 1 · THE REGISTER
    const before = await storageNow(A.page);
    expect(before.keys.filter((k) => !isBasisStorageKey(k)), 'every storage key a real boot writes is Basis\'s by name').toEqual([]);
    expect(before.dbs.filter((n) => !isBasisDatabase(n)), 'every database a real boot opens is Basis\'s by name').toEqual([]);

    // the rest of the origin: the public site's key and a toolbox screen page's pairing
    await A.page.evaluate((f) => { for (const [k, v] of Object.entries(f)) window.localStorage.setItem(k, v); }, FOREIGN);

    // 2 · A MARK WITH NO PHRASE: another script, a stale mark — it opens the phrase page and clears nothing
    await A.page.evaluate((m) => window.localStorage.setItem(m, JSON.stringify({ stage: 'marked', fingerprint: null })), MARK);
    await A.page.reload();
    await expect(A.page.locator('[data-testid="start-over"]')).toBeVisible({ timeout: 30_000 });
    await expect(A.page.locator('[data-testid="start-over"]'), 'the page speaks words, not locale keys').not.toContainText('circle.start_over.');
    const marked = await storageNow(A.page);
    expect(marked.keys.filter((k) => k.startsWith('cc-chat-id:')).length, 'nothing was cleared by the mark').toBeGreaterThan(0);
    await A.page.locator('[data-testid="start-over-cancel"]').click();
    await A.page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
    const cancelled = await storageNow(A.page);
    expect(cancelled.keys).not.toContain(MARK);
    expect(await phraseOf(A.page), 'the same person after cancel').toEqual({ phrase });

    // 3 · THE WAY OUT: from the launcher's door, a fresh load opens the page
    await A.page.evaluate(() => { window.sessionStorage.setItem('basis.startOverPage', '1'); });
    await A.page.reload();
    await expect(A.page.locator('[data-testid="start-over"]')).toBeVisible({ timeout: 30_000 });
    await A.page.locator('.start-over__phrase').fill('twee woorden');
    await A.page.locator('[data-testid="start-over-check"]').click();
    await expect(A.page.locator('.start-over__said')).not.toBeEmpty();
    await expect(A.page.locator('[data-testid="start-over-yes"]')).toHaveCount(0);
    await A.page.locator('.start-over__phrase').fill(phrase);
    await A.page.locator('[data-testid="start-over-check"]').click();
    await A.page.locator('[data-testid="start-over-yes"]').click();
    // which branch: the page reloads (success), or it says why it stopped
    const outcome = await Promise.race([
      A.page.waitForEvent('framenavigated', { timeout: 90_000 }).then(() => 'reloaded'),
      A.page.waitForFunction(() => { const s = document.querySelector('.start-over__said')?.textContent ?? ''; return s && !/…$|\.working$/.test(s) ? s : null; }, null, { timeout: 90_000 }).then((h) => h.jsonValue()).then((s) => `said: ${s}`),
    ]);
    expect(outcome, 'the start-over finished and reloaded').toBe('reloaded');
    await A.page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 90_000 });
    const after = await storageNow(A.page);
    for (const k of Object.keys(FOREIGN)) expect(after.keys, `${k} stays`).toContain(k);
    expect(after.keys).not.toContain(MARK);
    const whoAfter = async () => { for (let i = 0; i < 60; i += 1) { try { const w = (await call(A.page, 'pinboard', 'whoAmI', {}))?.webid; if (w) return w; } catch { /* booting */ } await new Promise((r) => { setTimeout(r, 1000); }); } return null; };
    expect(await whoAfter(), 'the same person after the start-over (the same webid)').toBe(who);
  });
});
