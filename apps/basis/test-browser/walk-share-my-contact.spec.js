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
    expect(await A.page.locator('canvas.cc-share__qr').getAttribute('data-encodes'), 'the QR is the LINK — a phone camera opens it').toBe('link');
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
    // What either side refuses inside the pair circle during the join — read at STEP5.
    const refusedOnB = []; const refusedOnA = [];
    B.page.on('console', (m) => { const t = m.text(); if (/refused a validly-signed envelope/.test(t)) refusedOnB.push(t.slice(0, 260)); });
    A.page.on('console', (m) => { const t = m.text(); if (/refused a validly-signed envelope/.test(t)) refusedOnA.push(t.slice(0, 260)); });
    // The link as A painted it names A's origin; B's server is the same one — keep B's relay seed on the query.
    // Opened the way a person opens a link: a fresh page load (a tab of its own), not a fragment change.
    const dest = `${new URL(B.page.url()).pathname}${new URL(B.page.url()).search}${link.slice(link.indexOf('#'))}`;
    await B.page.goto('about:blank');
    await B.page.goto(dest);
    // the boot takes the card once the agent is up — poll for the scrub rather than guess the boot's length
    await expect.poll(() => new URL(B.page.url()).hash, { timeout: 30_000, message: 'the card is scrubbed from B\'s address bar once the boot took it' }).toBe('');
    await B.page.waitForTimeout(2000);
    await gotoCircles(B.page);
    await B.page.locator('[data-tab="contacten"]').first().click();
    await B.page.waitForTimeout(1500);
    const row = B.page.locator(`.cc-contacts__row[data-contact-id="${aId}"]`);
    expect(await row.count(), `B's Contacten has a row for A (${String(aId).slice(0, 12)}…)`).toBe(1);
    expect(await row.locator('.cc-contacts__name').textContent(), 'named as A named itself').toBe('Anna');
    log('STEP2 B opens the link', 'PASS', 'Anna is a contact on B');

    // ── B writes to Anna; A's screen shows it ─────────────────────────────────────────────────────
    // B names itself first, as a tester does under Mij: the first message carries B's card, so A's row for B reads "Bea".
    await B.page.locator('[data-tab="mij"]').first().click(); await B.page.waitForTimeout(1200);
    await B.page.locator('.cc-profile__display').fill('Bea'); await B.page.locator('.cc-profile__save').click(); await B.page.waitForTimeout(1500);
    await gotoCircles(B.page);
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
    // ── Before A opens anything: the Contacten tab says something is new, and B's row carries the count (2026-09-21,
    // Frits: "add some 'new message' visual to the contacts frame — I have to check each contact all the time").
    await gotoCircles(A.page);
    const badgeState = async () => A.page.evaluate(async () => ({
      badge: document.querySelector('[data-tab="contacten"] .circle-tabbar__badge')?.textContent ?? null,
      tabs: [...document.querySelectorAll('[data-tab]')].map((b) => b.dataset.tab),
      turns: ((await window.onderlingContactChannel?.rehydrateAll?.()) ?? []).map((t) => `${String(t.contactId).slice(0, 8)}:${t.origin}:${t.ts}`),
      seen: (() => { try { return localStorage.getItem('cc.contactSeenAt'); } catch { return 'n/a'; } })(),
    })).catch((e) => String(e));
    try {
      await expect.poll(async () => (await badgeState())?.badge, { timeout: 30_000 }).toBe('1');
    } catch (e) {
      throw new Error(`the Contacten tab shows the unread count — state: ${JSON.stringify(await badgeState())}`);
    }
    await A.page.locator('[data-tab="contacten"]').first().click(); await A.page.waitForTimeout(1500);
    const unreadRows = await A.page.evaluate(() => [...document.querySelectorAll('.cc-contacts__row.is-unread')].map((r) => `${r.dataset.contactId?.slice(0, 12)}:${r.querySelector('.cc-contacts__unread')?.textContent}`));
    expect(unreadRows.length, `exactly B's row is unread: ${JSON.stringify(unreadRows)}`).toBe(1);
    expect(unreadRows[0].endsWith(':1')).toBe(true);
    log('STEP3a new on A', 'PASS', `tab badge 1, row ${unreadRows[0]}`);
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
    // …and A's row for B is NAMED (2026-09-21): the first message carried B's card. Frits' laptop, 09-21: "most
    // contacts have these codes as names still".
    await gotoCircles(A.page);
    await A.page.locator('[data-tab="contacten"]').first().click(); await A.page.waitForTimeout(1500);
    const bRowName = await A.page.locator(`.cc-contacts__row[data-contact-id="${seen.contactId}"] .cc-contacts__name`).first().textContent().catch(() => null);
    expect(bRowName, 'A\'s Contacten names B by the name B gave itself — the card rode the first message').toBe('Bea');
    // …and having opened the thread, the badge is gone: read is read.
    expect(await A.page.locator('.cc-contacts__row.is-unread').count(), 'opening the thread cleared the row').toBe(0);
    expect(await A.page.locator('[data-tab="contacten"] .circle-tabbar__badge').count(), '…and the tab').toBe(0);
    log('STEP3 B writes, A sees it', 'PASS', `row ${String(seen.contactId).slice(0, 12)}… named "${bRowName}", read`);

    // ── B writes AGAIN, once the pair roster has formed: this one rides the pair route, from B's per-circle
    // address. It must land in the SAME thread — the one keyed by B — not in one keyed by an address no row opens.
    // …and B RELOADS first, the way a phone does between two visits (2026-09-21, Frits' phone → Wilfred): after a
    // reload the per-circle addresses must be registered on the relay again, pair circles included, or the send
    // over the pair route leaves as B's canonical identity and A's door refuses it — "sent" on B, nothing on A.
    await B.page.waitForTimeout(6000);
    await B.page.reload({ waitUntil: 'load' });
    await B.page.waitForTimeout(8000);
    await gotoCircles(B.page);
    const second = `en nog een, over de pair-route ${Date.now().toString(36)}`;
    const sent2 = await sendDirectMessage(B.page, second, { to: aId });
    expect(sent2.sent, `B could not write again: ${sent2.why}`).toBe(true);
    const seen2 = await waitForContactMessageDetailed(A.page, second, { tries: 12, every: 3000 });
    if (!seen2.painted) {
      const outcomes = await B.page.evaluate(() => window.__sendOutcomes ?? null).catch((e) => String(e));
      const aHolds = await A.page.evaluate(async (m) => {
        const peers = ((await window.onderlingPeers?.all?.()) ?? []).map((p) => p.pubKey ?? p.id);
        const threads = {};
        for (const id of peers) { try { threads[String(id).slice(0, 12)] = ((await window.onderlingContactChannel?.rehydrate?.(id)) ?? []).map((t) => `${t.origin}:${String(t.text).slice(0, 20)}`); } catch (e) { threads[String(id).slice(0, 12)] = String(e); } }
        const resolves = {}; for (const id of peers) resolves[String(id).slice(0, 12)] = String(window.onderlingIdentityOf?.(id) ?? null).slice(0, 12);
        return { peers: peers.map((r) => String(r).slice(0, 12)), resolves, threads, m };
      }, second).catch((e) => String(e));
      console.log(`### STEP4 diagnostics\nB sent: ${JSON.stringify(outcomes)}\nA holds: ${JSON.stringify(aHolds)}`);
    }
    expect(seen2.found, 'B\'s second message (over the pair route) never reached A — see "STEP4 diagnostics"').toBe(true);
    expect(seen2.painted, 'B\'s second message is on A\'s device but NOT on the screen — stored under an address no row opens (the direct path keyed by the sender address, not the person)').toBe(true);
    expect(seen2.contactId, 'the same thread as the first message').toBe(seen.contactId);
    log('STEP4 the second message', 'PASS', 'same thread, painted');
    // NOTHING REFUSED inside the pair circle during the join. Until 2026-09-21 two envelopes were, every run: the
    // joiner's lane catch-up requests left as its pair-circle address FOR THE ADMIN'S GLOBAL address (`listGroupRoster`
    // names webids), so the admin — met at its canonical door — answered the greeting canonically, to a per-circle
    // address, which the joiner's gate rightly refused. The catch-ups aim at the member's per-circle address now
    // (`catchUpTargets`); a refusal here again means a lane found its way back to a global key.
    const pairRefusals = [...refusedOnB.map((t) => `B: ${t}`), ...refusedOnA.map((t) => `A: ${t}`)].filter((t) => /pair-/.test(t));
    expect(pairRefusals, 'no envelope is refused inside the pair circle during the join').toEqual([]);
    // B holds the founder's per-circle address on the pair roster — the circle was learned, on the channel that works.
    const bRoster = await B.page.evaluate(async (a) => {
      const ids = ((await window.onderlingCall('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter((id) => String(id).startsWith('pair-'));
      if (!ids.length) return { pair: null };
      const r = await window.onderlingCall('stoop', 'listGroupMembers', { groupId: ids[0] });
      const row = (r?.members ?? []).find((m) => m.webid === a);
      return { pair: ids[0], founderAddress: row?.circleAddress ?? null };
    }, aId);
    expect(bRoster.pair, 'B is in the pair circle with A').toBeTruthy();
    expect(bRoster.founderAddress, 'B holds A\'s proven per-circle address there').toBeTruthy();
    log('STEP5 the circle was learned', 'PASS', `pair ${String(bRoster.pair).slice(0, 14)}…, founder at ${String(bRoster.founderAddress).slice(0, 12)}…`);

    // ── B renames under Mij; A's Contacten row for B renames — THE BOOK READS THE ROSTER (2026-09-21). ────
    // The name travels as B's `member-props` statement on the pair circle's membership lane, folded on A; the row's
    // name is what the roster says, the card (which named the row "Bea" at STEP3) the fallback. No message is sent.
    const bId = (await B.page.evaluate(async () => window.onderlingCall('stoop', 'whoAmI', {})))?.webid;
    await gotoCircles(B.page);   // B sits in the thread after STEP4: back to the launcher, where Mij is
    await B.page.locator('[data-tab="mij"]').first().click(); await B.page.waitForTimeout(1200);
    await B.page.locator('.cc-profile__display').fill('Beatrix'); await B.page.locator('.cc-profile__save').click(); await B.page.waitForTimeout(1500);
    await gotoCircles(A.page);
    await A.page.locator('[data-tab="contacten"]').first().click(); await A.page.waitForTimeout(1000);
    const aRowName = async () => {
      // the roster folds on arrival; the painted row is re-read on each poll (Contacten re-opened)
      await A.page.locator('[data-tab="mij"]').first().click(); await A.page.waitForTimeout(300);
      await A.page.locator('[data-tab="contacten"]').first().click(); await A.page.waitForTimeout(700);
      return A.page.locator(`.cc-contacts__row[data-contact-id="${bId}"] .cc-contacts__name`).first().textContent().catch(() => null);
    };
    try {
      await expect.poll(aRowName, { timeout: 45_000 }).toBe('Beatrix');
    } catch {
      const aRoster = await A.page.evaluate(async (b) => {
        const ids = ((await window.onderlingCall('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter((id) => String(id).startsWith('pair-'));
        const out = {};
        for (const id of ids) { const r = await window.onderlingCall('stoop', 'listGroupMembers', { groupId: id }); out[id.slice(0, 14)] = (r?.members ?? []).map((m) => `${String(m.webid).slice(0, 8)}:${m.displayName ?? ''}:${JSON.stringify(m.said ?? null)}`); }
        return out;
      }, bId).catch((e) => String(e));
      throw new Error(`A's row for B did not take the roster's name — painted "${await aRowName()}"; A's pair rosters: ${JSON.stringify(aRoster)}`);
    }
    log('STEP6 the book reads the roster', 'PASS', 'B renamed under Mij; A\'s row reads "Beatrix" without a message');
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
