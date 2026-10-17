/**
 * A DEVICE WITHOUT THE GENERAL PERSONA, on real browser bytes (the WebCrypto key door, the sealed vaults, the reload).
 * A makes a persona Werk; B is enrolled from A with Werk only — the general persona left off. After its reload B runs
 * Werk and nothing else: its switcher has one self, it does not speak as A's general persona, and nothing throws.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/default-less-device.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(180_000);
const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);

test('enrolled with Werk only, a device runs Werk alone and speaks as it', async ({ browser }) => {
  const ctxA = await browser.newContext(); const ctxB = await browser.newContext();
  const A = await ctxA.newPage(); const B = await ctxB.newPage();
  const errs = [];
  B.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  try {
    for (const p of [A, B]) { await p.goto('/'); await expect(p.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 }); }
    const made = await call(A, 'agents', 'createProfile', { name: 'Werk' });
    expect(made?.created, JSON.stringify(made)).toBe(true);
    const phrase = (await call(A, 'household', 'revealOwnerPhrase', {}))?.mnemonic;
    const general = (await call(A, 'pinboard', 'whoAmI'))?.webid;

    expect((await call(A, 'pinboard', 'createGroupV2', { groupId: 'thuis-walk', name: 'Thuis', rules: { text: 't' } }))?.groupId).toBe('thuis-walk');
    // an ADD from an offer (not a restore): the offer is stashed on B first, as the shells do when it is scanned
    const offer = await call(A, 'household', 'buildEnrollOffer', {});
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const en = await B.evaluate(async ([uri, args]) => { localStorage.setItem('onderling.enrollOffer', uri); return window.onderlingCall('household', 'enrollDevice', args); },
      [offer.uri, { mnemonic: phrase, label: 'werklaptop', personas: [made.id], withDefault: false }]);
    expect(en?.ok, JSON.stringify(en)).toBe(true);
    await B.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => B.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
    await expect(B.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 });

    // the offer named A's GENERAL-persona circles in the clear: B, holding no general persona, steps into none of them
    // (it would be Werk walking into the general persona's circles — the one thing a persona exists to keep apart)
    const generalCircles = ['thuis-walk'];   // made on A as the general persona, before the offer (cc-help is every device's own)
    await B.waitForTimeout(8000);   // the consume runs after boot; give it its turn
    const onB = ((await call(B, 'pinboard', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id)));
    for (const c of generalCircles) expect(onB, `B is not in the general persona's circle ${c}`).not.toContain(c);
    const me = (await call(B, 'pinboard', 'whoAmI'))?.webid;
    expect(me, 'B speaks as someone').toBeTruthy();
    expect(me, 'not as the general persona').not.toBe(general);
    await B.locator('.cc-header-avatar__button').click();
    const rows = B.locator('.cc-persona-switcher__row');
    // one self: with a single self the avatar opens the editor, not the switcher — either way, no general-persona row
    expect(await B.locator('.cc-persona-switcher__row[data-self="default"]').count(), 'no general persona on B').toBe(0);
    if (await rows.count()) await expect(rows).toHaveCount(1);
    expect(errs, 'no page errors on B').toEqual([]);
  } finally { await ctxA.close(); await ctxB.close(); }
});
