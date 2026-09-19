/**
 * SHARE MY CONTACT, ON REAL SCREENS (2026-09-19, Frits: "it is supposed to simply link to the website, including
 * the contact"). A opens Mij → "Mijn contact delen", reads the LINK the panel offers; B — a fresh app — opens that
 * link and finds A in Contacten, named; B writes to A; A's Contacten shows B's message, painted. No circle anywhere:
 * this is how two people who met outside the app reach each other.
 *
 * Arm with a local relay (the fixture starts it):
 *   PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-share-my-contact.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('A shares a link from Mij; B opens it, has A as a contact, writes; A sees it', async ({ browser }) => {
  test.setTimeout(240_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A');
    await gotoCircles(A.page);
    // A gives itself a name, so B's row for A reads as a person, not a key.
    await A.page.locator('[data-tab="mij"]').first().click();
    await A.page.waitForTimeout(1200);
    await A.page.locator('.cc-profile__display').fill('Anna');
    await A.page.locator('.cc-profile__save').click();
    await A.page.waitForTimeout(1500);
    // ── Mij → share my contact: the panel with the QR, the code, the link ──────────────────────────
    await A.page.locator('.cc-profile__share-contact').click();
    await expect(A.page.locator('.cc-share__title')).toBeVisible();
    expect(await A.page.locator('canvas.cc-share__qr').count(), 'the QR is painted').toBe(1);
    const code = await A.page.locator('.cc-share__code input').inputValue();
    expect(code.startsWith('onderling-contact://'), `the code is the card: ${code.slice(0, 30)}`).toBe(true);
    const link = await A.page.locator('.cc-share__link input').inputValue();
    expect(link, 'the link is THIS app\'s url with the contact in the fragment').toMatch(/^http:\/\/localhost:\d+\/#contact=[A-Za-z0-9_-]+$/);
    const aId = (await A.page.evaluate(async () => window.onderlingCall('stoop', 'whoAmI', {})))?.webid;
    await A.page.locator('.cc-share__back').click();   // back to Mij — the panel is a sub-screen without the tab bar
    await A.page.waitForTimeout(800);
    log('STEP1 A shares', 'PASS', `link ${link.slice(0, 40)}…`);

    // ── B, a fresh app, opens the link: the contact is added, Contacten shows Anna ─────────────────
    B = await bootPeer(browser, 'B');
    B.page.on('dialog', (d) => d.dismiss().catch(() => {}));   // the "added" notice is an alert here
    // The link as A painted it names A's origin; B's server is the same one — keep B's relay seed on the query.
    // Opened the way a person opens a link: a fresh page load (a tab of its own), not a fragment change.
    const dest = `${new URL(B.page.url()).pathname}${new URL(B.page.url()).search}${link.slice(link.indexOf('#'))}`;
    await B.page.goto('about:blank');
    await B.page.goto(dest);
    await B.page.waitForTimeout(6000);
    expect(new URL(B.page.url()).hash, 'the card is scrubbed from B\'s address bar').toBe('');
    await gotoCircles(B.page);
    await B.page.locator('[data-tab="contacten"]').first().click();
    await B.page.waitForTimeout(1500);
    const row = B.page.locator(`.cc-contacts__row[data-contact-id="${aId}"]`);
    expect(await row.count(), `B's Contacten has a row for A (${String(aId).slice(0, 12)}…)`).toBe(1);
    expect(await row.locator('.cc-contacts__name').textContent(), 'named as A named itself').toBe('Anna');
    log('STEP2 B opens the link', 'PASS', 'Anna is a contact on B');

    // ── B writes to Anna; A's screen shows it ─────────────────────────────────────────────────────
    const marker = `hoi Anna, via je link ${Date.now().toString(36)}`;
    // What B's send returned (route, verdict), kept for a red.
    await B.page.evaluate(() => {
      const ch = window.onderlingContactChannel; if (!ch) return;
      window.__sendOutcomes = [];
      const orig = ch.sendTurn.bind(ch);
      ch.sendTurn = (turn) => { const r = orig(turn); const rec = { to: String(turn.peerAddr).slice(0, 12) }; window.__sendOutcomes.push(rec); Promise.resolve(r.sent).then((o) => { rec.out = JSON.parse(JSON.stringify(o ?? null)); }, (e) => { rec.error = String(e?.message ?? e); }); return r; };
    });
    const sent = await sendDirectMessage(B.page, marker, { to: aId });
    expect(sent.sent, `B could not write: ${sent.why}`).toBe(true);
    const seen = await waitForContactMessageDetailed(A.page, marker, { tries: 12, every: 3000 });
    if (!seen.found) {
      const bWho = await B.page.evaluate(async () => { const w = await window.onderlingCall('stoop', 'whoAmI', {}); return { webid: String(w?.webid).slice(0, 12), pubKey: String(w?.pubKey).slice(0, 12), person: String(w?.personAddress ?? '').slice(0, 12) }; }).catch((e) => String(e));
      const outcomes = await B.page.evaluate(() => window.__sendOutcomes ?? null).catch((e) => String(e));
      const aHolds = await A.page.evaluate(async (m) => {
        const rows = [...document.querySelectorAll('.cc-contacts__row')].map((r) => r.dataset.contactId);
        const peers = ((await window.onderlingPeers?.all?.()) ?? []).map((p) => p.pubKey ?? p.id);
        const ids = [...new Set([...rows, ...peers])];
        const threads = {};
        for (const id of ids) { try { threads[String(id).slice(0, 12)] = ((await window.onderlingContactChannel?.rehydrate?.(id)) ?? []).map((t) => `${t.origin}:${String(t.text).slice(0, 20)}`); } catch (e) { threads[String(id).slice(0, 12)] = String(e); } }
        const resolves = {}; for (const id of peers) resolves[String(id).slice(0, 12)] = String(window.onderlingIdentityOf?.(id) ?? null).slice(0, 12);
        const own = ((await window.onderlingOwnAddresses?.()) ?? []).map((a) => String(a).slice(0, 12));
        return { rows: rows.map((r) => String(r).slice(0, 12)), peers: peers.map((r) => String(r).slice(0, 12)), resolves, own, threads, m };
      }, marker).catch((e) => String(e));
      // …and what Contacten paints when opened deliberately and given time.
      await gotoCircles(A.page);
      await A.page.locator('[data-tab="contacten"]').first().click();
      await A.page.waitForTimeout(4000);
      const contacten = await A.page.evaluate(() => ({ rows: [...document.querySelectorAll('.cc-contacts__row')].map((r) => `${r.dataset.contactId?.slice(0, 12)}:${r.querySelector('.cc-contacts__name')?.textContent}`), text: (document.querySelector('.cc-contacts')?.innerText ?? document.body.innerText).slice(0, 300) })).catch((e) => String(e));
      console.log(`### STEP3 diagnostics\nB is ${JSON.stringify(bWho)}\nB sent: ${JSON.stringify(outcomes)}\nA holds: ${JSON.stringify(aHolds)}\nA Contacten: ${JSON.stringify(contacten)}`);
    }
    expect(seen.found, 'B\'s message never reached A — see "STEP3 diagnostics"').toBe(true);
    expect(seen.painted, 'reached A but not painted').toBe(true);
    log('STEP3 B writes, A sees it', 'PASS', `row ${String(seen.contactId).slice(0, 12)}…`);
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
