/**
 * walk-drie.spec.js — DE WANDELING MET DRIE, driven through the real web shells.
 *
 * The script is Frits' one-page walk (`plans/WALK-three-members-frits.md`, 2026-09-11): A (web, admin)
 * makes the circle; B (the phone — the alpha is web-only, so B is this app in a phone-sized browser)
 * joins first and is the baseline C must not break; C joins later and is removed. Seven steps, and at
 * every step what each device must SHOW. Run against the real relay when the point is "real shells,
 * real wire" (2026-09-14, after every catch-up between members started going over the real wire):
 *
 *   PEER_TEST_RELAY=wss://relay.onderling.org npx playwright test --project=relay walk-drie
 *
 * Every step logs a verdict and takes a screenshot per device into the test's output dir — the
 * screenshots are what Frits reviews with his own eyes; this spec asserts what a script can see.
 * A step that cannot be driven from the UI says so (BLOCKED) rather than faking it through an op;
 * where the walk offers two doors to one act (Beheer, or the assistant in words) this uses BOTH
 * across steps 5 and 6, as the script asks.
 */
import { test, expect } from '@playwright/test';
import {
  bootPeer, teardown, gotoCircles, createCircle, openCircleMatching, tileNames, toChat, sendChat,
  readBubbles, waitForBubble, getInvite, joinFromInvite, readRoster, openMore, openTakenTab, addTask,
  enableTasks, enableFeature, log,
} from './peerHarness.js';

test.setTimeout(900_000);

const CIRCLE = 'Wandeling';
const RE = /wandeling/i;
const PHONE = { width: 390, height: 844 };
/** A row that shows a raw key instead of a name — what step 2 must NOT see. */
const looksLikeKey = (s) => /[A-Za-z0-9_-]{30,}/.test(s);

/** A screenshot for Frits' eyes: the conversation scrolled to its newest line, the whole page. */
async function snap(page, name) {
  await page.evaluate(() => { for (const el of document.querySelectorAll('.circle-view__list')) el.scrollTop = el.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true }).catch(() => {});
}
/** The same moment on every device. */
async function shotAll(peers, name) {
  for (const p of peers) await snap(p.page, `${name}-${p.label}`);
}
/** Open the circle on a device and land on the conversation. */
async function openWalk(page) {
  await gotoCircles(page);
  await openCircleMatching(page, RE);
  await toChat(page);
}
/** Wait for a bubble on a device and log the verdict in the walk's words. */
async function sees(peer, needle, step, opts = {}) {
  const got = await waitForBubble(peer.page, needle, opts);
  log(`${step} · ${peer.label} ziet "${needle}"`, got ? 'PASS' : 'FAIL', got ? 'aangekomen' : `niet gezien — bubbels: ${JSON.stringify((await readBubbles(peer.page)).slice(-4))}`);
  return got;
}
/** The members tab as one device shows it: the row texts. */
async function leden(peer) {
  const r = await readRoster(peer.page);
  return r.names;
}
/** A page's whole visible text — for notices that are not bubbles. */
const pageText = (page) => page.locator('body').innerText().then((s) => s.replace(/\s+/g, ' '));

test('de wandeling met drie — A maakt, B is de basis, C komt en gaat', async ({ browser }) => {
  const A = await bootPeer(browser, 'A');
  const B = await bootPeer(browser, 'B', { viewport: PHONE });
  const C = await bootPeer(browser, 'C');
  const all = [A, B, C];
  // Three shells booting on one dev server against a real relay: give each its launcher before the
  // script starts, and say which one never painted rather than fail three steps later on an empty page.
  for (const p of all) {
    p.page.on('console', (m) => { const t = m.text(); if (/error|failed|refused/i.test(t)) console.log(`[${p.label} console!] ${t.slice(0, 200)}`); });
    const launcher = () => p.page.locator('.circle-launcher__join').first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
    let up = await launcher();
    if (!up) {
      // Seen on the real relay (2026-09-14): one of three pages loaded nothing at all — no console
      // line, an empty root — while the other two booted. A reload brings it up; the run says so.
      await snap(p.page, `0-boot-${p.label}-leeg`);
      await p.page.reload().catch(() => {});
      up = await launcher();
      console.log(`### 0 · ${p.label} laadde niets bij de eerste keer: ${up ? 'OBSERVED — na een herlaad wél' : 'FAIL — ook na een herlaad niet'}`);
    }
  }
  const findings = [];
  const note = (step, verdict, text) => { log(step, verdict, text); if (verdict !== 'PASS' && verdict !== 'OBSERVED') findings.push(`${step}: ${verdict} — ${text}`); };

  try {
    // ── 1 · A maakt de kring ──────────────────────────────────────────────────────────────────
    await gotoCircles(A.page);
    await createCircle(A.page, CIRCLE);
    const tiles = await tileNames(A.page);
    note('1 · de tegel op A', tiles.some((s) => RE.test(s)) ? 'PASS' : 'FAIL', `tegels: ${JSON.stringify(tiles)}`);
    await snap(A.page, '1-tegel-A');
    await openCircleMatching(A.page, RE);
    await toChat(A.page);

    // ── 2 · B wordt lid ───────────────────────────────────────────────────────────────────────
    await gotoCircles(B.page);
    // A real relay makes the phone's boot longer; the launcher's join button is the sign it is there.
    await B.page.locator('.circle-launcher__join').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    await snap(B.page, '2-launcher-B');
    const invite1 = await getInvite(A.page, '2-uitnodiging-A');
    expect(invite1, 'A kon geen uitnodiging tonen').toBeTruthy();
    const joinB = await joinFromInvite(B.page, invite1, { handle: 'bee', tag: '2-word-lid-B' });
    note('2 · B wordt lid', joinB.joined ? 'PASS' : 'FAIL', joinB.outcome);
    await openWalk(B.page);
    await openWalk(A.page);
    await B.page.waitForTimeout(4000);
    const ledenA2 = await leden(A);
    const ledenB2 = await leden(B);
    note('2 · Leden op A', ledenA2.length === 2 ? 'PASS' : 'FAIL', JSON.stringify(ledenA2));
    note('2 · Leden op B', ledenB2.length === 2 ? 'PASS' : 'FAIL', JSON.stringify(ledenB2));
    note('2 · "Jij" op de eigen rij', ledenA2.some((s) => /\bjij\b/i.test(s)) && ledenB2.some((s) => /\bjij\b/i.test(s)) ? 'PASS' : 'FAIL', `A: ${ledenA2.find((s) => /jij/i.test(s)) ?? '—'} · B: ${ledenB2.find((s) => /jij/i.test(s)) ?? '—'}`);
    const aRowAtB = ledenB2.find((s) => !/\bjij\b/i.test(s)) ?? '';
    note("2 · A's rij bij B is een naam, geen sleutel", aRowAtB && !looksLikeKey(aRowAtB) ? 'PASS' : 'FINDING', aRowAtB || 'geen rij');
    await shotAll([A, B], '2-leden');

    // ── 3 · De basis ──────────────────────────────────────────────────────────────────────────
    await toChat(A.page); await toChat(B.page);
    await sendChat(A.page, 'hallo bee');
    await sees(B, 'hallo bee', '3');
    await sendChat(B.page, 'hallo terug');
    await sees(A, 'hallo terug', '3');
    // Under A's message on B: A's name, not a raw key.
    const bubblesB = await readBubbles(B.page);
    const aBubbleAtB = bubblesB.find((s) => s.includes('hallo bee')) ?? '';
    note("3 · onder A's bericht bij B staat een naam", aBubbleAtB && !looksLikeKey(aBubbleAtB) ? 'PASS' : 'FINDING', aBubbleAtB);
    // The delivery chip under B's own message settles on "their app has it" (the chip is a glyph; its
    // state is in `data-delivery-state`, its words in the title) — not stuck on "maybe".
    const chipState = async () => {
      const chips = B.page.locator('.circle-view__bubble-delivery');
      const n = await chips.count();
      return n ? { state: await chips.nth(n - 1).getAttribute('data-delivery-state'), label: await chips.nth(n - 1).getAttribute('title') } : null;
    };
    let chip = null;
    for (let i = 0; i < 12; i += 1) {
      await B.page.waitForTimeout(2000);
      chip = await chipState();
      if (chip?.state === 'stored') break;
    }
    note("3 · bezorgstatus onder B's bericht", chip?.state === 'stored' ? 'PASS' : 'FINDING', chip ? `${chip.state} — "${chip.label}"` : 'geen bezorgchip onder het bericht');
    await shotAll([A, B], '3-basis');

    // ── 4 · C komt erbij — en de basis mag niet breken ────────────────────────────────────────
    await gotoCircles(C.page);
    await C.page.locator('.circle-launcher__join').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    // The same code first (it holds to the ceiling); a fresh one if it is refused.
    let joinC = await joinFromInvite(C.page, invite1, { handle: 'cee', tag: '4-word-lid-C' });
    if (!joinC.joined) {
      await openWalk(A.page);
      const invite2 = await getInvite(A.page, '4-uitnodiging-A-opnieuw');
      await gotoCircles(C.page);
      joinC = invite2 ? await joinFromInvite(C.page, invite2, { handle: 'cee', tag: '4-word-lid-C-2' }) : joinC;
    }
    note('4 · C wordt lid', joinC.joined ? 'PASS' : 'FAIL', joinC.outcome);
    for (const p of all) await openWalk(p.page);
    await C.page.waitForTimeout(6000);
    for (const p of all) {
      const rows = await leden(p);
      note(`4 · Leden op ${p.label} = A, B, C`, rows.length === 3 ? 'PASS' : 'FAIL', JSON.stringify(rows));
    }
    await shotAll(all, '4-leden');
    // Six messages, every pair both ways. B→A after C's arrival is the one that can break silently.
    for (const p of all) await toChat(p.page);
    const pairs = [[A, B], [A, C], [B, A], [B, C], [C, A], [C, B]];
    for (const [from, to] of pairs) {
      const text = `${from.label} aan ${to.label}`;
      await sendChat(from.page, text);
      await sees(to, text, '4');
    }
    await shotAll(all, '4-zes-berichten');

    // ── 5 · Een rolwijziging, gevolgd door een taak ───────────────────────────────────────────
    // The Beheer door: ⋯ → Beheer → on bee's row "Beheerder maken", then the confirmation.
    const opened = await openMore(A.page, 'admin');
    note('5 · ⋯ → Beheer op A', opened ? 'PASS' : 'BLOCKED', opened ? 'het paneel is er' : 'geen Beheer in het ⋯-menu');
    if (opened) {
      const beeRow = A.page.locator('.cc-admin__member', { hasText: /bee/i });
      const setRole = beeRow.locator('.cc-admin__member-role-set');
      if (await setRole.count()) {
        await snap(A.page, '5-beheer-A');
        await setRole.first().click();
        await A.page.waitForTimeout(800);
        // The confirmation the op declares — accept it.
        const confirm = A.page.locator('.cc-confirm__accept');
        if (await confirm.count()) await confirm.first().click();
        await A.page.waitForTimeout(2500);
        await snap(A.page, '5-beheer-A-na');
        const back = A.page.locator('.cc-admin__back');
        if (await back.count()) await back.first().click();
      } else note('5 · "Beheerder maken" op bee\'s rij', 'BLOCKED', `rijen: ${JSON.stringify(await A.page.locator('.cc-admin__member').allTextContents())}`);
    }
    for (const p of all) await openWalk(p.page);
    // The script expects "bee is nu beheerder van deze kring" on all three. Where each device shows it:
    for (const p of all) {
      const got = await waitForBubble(p.page, 'beheerder van deze kring', { tries: 6, every: 2000 });
      const text = (await readBubbles(p.page)).find((s) => /beheerder van deze kring/i.test(s)) ?? '';
      note(`5 · ${p.label} ziet de rolwijziging in Gesprek`, got ? 'PASS' : 'FINDING', got ? text : `geen bericht in Gesprek${p.label === 'A' ? ' (A zag het wel als melding in het Beheer-paneel — zie 5-beheer-A-na.png)' : ''}`);
    }
    for (const p of all) {
      const rows = await leden(p);
      // The row that was PROMOTED — recognised by its provenance, since C does not see B's handle (below).
      const bRow = rows.find((s) => /benoemd door een beheerder/i.test(s)) ?? rows.find((s) => /bee/i.test(s)) ?? '';
      note(`5 · Leden op ${p.label}: bee is beheerder`, /beheerder|admin/i.test(bRow) ? 'PASS' : 'FAIL', bRow || JSON.stringify(rows));
    }
    // What the members see of each other's NAMES: the admin sees @bee and @cee; do B and C see each other's handle?
    const rowsB = await leden(B); const rowsC = await leden(C);
    note('5 · B ziet C\'s handle (@cee)', rowsB.some((s) => /cee/i.test(s)) ? 'PASS' : 'FINDING', `B's Leden: ${JSON.stringify(rowsB)}`);
    note('5 · C ziet B\'s handle (@bee)', rowsC.some((s) => /bee/i.test(s)) ? 'PASS' : 'FINDING', `C's Leden: ${JSON.stringify(rowsC)}`);
    await shotAll(all, '5-leden-na-rol');
    // B (now an admin) adds a task. A fresh circle has tasks off by policy; an admin switches it on.
    await openWalk(B.page);
    const taken = await openTakenTab(B.page, { tries: 1 });
    if (!taken.present) {
      await openWalk(B.page);
      const on = await enableTasks(B.page).catch(() => false);
      note('5 · Taken aangezet door B', on ? 'OBSERVED' : 'FINDING', on ? 'de tab is er nu' : 'B kon Taken niet aanzetten (nog geen beheerder op B\'s eigen scherm?)');
    }
    await openWalk(B.page);   // back on the conversation — the composer lives there
    await addTask(B.page, 'brood halen');
    for (const p of [A, C]) {
      await openWalk(p.page);
      const t = await openTakenTab(p.page);
      const row = t.rows.find((s) => /brood halen/i.test(s)) ?? '';
      note(`5 · de taak bij ${p.label}`, row ? 'PASS' : 'FAIL', row ? `${row}${/bee/i.test(row) ? ' (met bee als maker)' : ' (maker niet zichtbaar op de rij)'}` : `rijen: ${JSON.stringify(t.rows)} (tab ${t.present ? 'aanwezig' : 'AFWEZIG'})`);
    }
    await shotAll(all, '5-taak');

    // ── 6 · Een verwijdering, gevolgd door een prikbordbericht ────────────────────────────────
    // The other door this time: the assistant, in words. Falls back to Beheer if nothing happens.
    for (const p of all) await openWalk(p.page);
    const before6 = (await readBubbles(A.page)).length;
    await sendChat(A.page, '@assistent verwijder cee uit de kring', 6000);
    const confirmA = A.page.locator('.cc-confirm__accept');
    if (await confirmA.count()) { await confirmA.first().click(); await A.page.waitForTimeout(2500); }
    let removed = false;
    for (let i = 0; i < 6 && !removed; i += 1) {
      await A.page.waitForTimeout(2000);
      removed = (await leden(A)).length === 2;
      await toChat(A.page);
    }
    const answered = (await readBubbles(A.page)).slice(before6 + 1).join(' | ');
    // Headless there is no model behind the assistant; what it answers is still worth the record.
    note('6 · verwijderen via de assistent (in woorden)', removed ? 'PASS' : 'BLOCKED', removed ? 'Leden op A = 2' : `niet verwijderd — de assistent antwoordde: ${JSON.stringify(answered).slice(0, 300) || 'niets'} (headless draait geen model; via Beheer dan)`);
    await snap(A.page, '6-assistent-A');
    if (!removed && await openMore(A.page, 'admin')) {
      const ceeRow = A.page.locator('.cc-admin__member', { hasText: /cee/i });
      const rm = ceeRow.locator('.cc-admin__member-remove');
      if (await rm.count()) { await rm.first().click(); await A.page.waitForTimeout(3000); }
      const back = A.page.locator('.cc-admin__back');
      if (await back.count()) await back.first().click();
      await openWalk(A.page);
      removed = (await leden(A)).length === 2;
      note('6 · verwijderen via Beheer', removed ? 'PASS' : 'FAIL', JSON.stringify(await leden(A)));
    }
    // C: told, at once, without doing anything.
    let told = false;
    for (let i = 0; i < 10 && !told; i += 1) {
      await C.page.waitForTimeout(2000);
      told = /je bent verwijderd|geen lid meer van deze kring/i.test(await pageText(C.page));
    }
    const toldText = (await readBubbles(C.page)).find((s) => /geen lid meer|verwijderd/i.test(s)) ?? '';
    note('6 · C: "Je bent verwijderd"', told ? 'PASS' : 'FAIL', told ? `direct, zonder dat C iets deed — ${toldText.slice(0, 160)}` : `C's scherm zegt het niet — bubbels: ${JSON.stringify((await readBubbles(C.page)).slice(-3))}`);
    // …and what ELSE C's conversation shows since the removal (the dry run saw empty bubbles from "Onbekend lid").
    const strays = (await readBubbles(C.page)).filter((s) => /onbekend lid/i.test(s));
    note('6 · C\'s Gesprek na de verwijdering', strays.length ? 'FINDING' : 'PASS', strays.length ? `${strays.length} bubbel(s) van "Onbekend lid": ${JSON.stringify(strays.slice(0, 2))}` : 'geen losse bubbels');
    await snap(C.page, '6-C-verwijderd');
    for (const p of [A, B]) {
      await openWalk(p.page);
      const rows = await leden(p);
      note(`6 · Leden op ${p.label} = A, B`, rows.length === 2 ? 'PASS' : 'FAIL', JSON.stringify(rows));
    }
    // A posts on the noticeboard. A fresh circle has the noticeboard OFF by policy (a tab exists only
    // when the feature is on) — the script assumes it is there, so A switches it on first and the run
    // says so.
    await openWalk(A.page);
    const boardTab = (page) => page.locator('.circle-view__tab[data-tab="noticeboard"]');
    if (!(await boardTab(A.page).count())) {
      const on = await enableFeature(A.page, 'noticeboard').catch(() => false);
      note('6 · Prikbord stond uit; A zet het aan', on ? 'OBSERVED' : 'FINDING', on ? 'via ⋯ → instellingen' : 'kon het niet aanzetten');
      await openWalk(A.page);
    }
    let posted = false;
    if (await boardTab(A.page).count()) {
      await boardTab(A.page).first().click();
      await A.page.waitForTimeout(1500);
      const input = A.page.locator('.cc-noticeboard__input');
      if (await input.count()) {
        await input.fill('C is er niet meer');
        await A.page.locator('.cc-noticeboard__post').click();
        await A.page.waitForTimeout(3000);
        posted = true;
      }
    }
    note('6 · A plaatst op Prikbord', posted ? 'PASS' : 'BLOCKED', posted ? 'via de tab, met de eigen composer' : `tab ${(await boardTab(A.page).count()) ? 'aanwezig, geen composer' : 'afwezig'}`);
    await snap(A.page, '6-prikbord-A');
    const seenOnBoard = async (peer) => {
      await openWalk(peer.page);
      const t = boardTab(peer.page);
      if (!(await t.count())) return null;
      for (let i = 0; i < 6; i += 1) {
        await t.first().click();
        await peer.page.waitForTimeout(2500);
        if ((await pageText(peer.page)).includes('C is er niet meer')) return true;
      }
      return false;
    };
    const onB = await seenOnBoard(B);
    note('6 · B ziet het prikbordbericht', onB === true ? 'PASS' : onB === null ? 'BLOCKED' : 'FAIL', onB === null ? 'geen Prikbord-tab op B' : '');
    const onC = await seenOnBoard(C);
    note('6 · C ziet NIETS', onC === false || onC === null ? 'PASS' : 'FAIL', onC === null ? 'C heeft geen Prikbord meer (verwijderd)' : onC ? 'C zag het bericht — de verwijdering hield niet' : 'niets bij C');
    await shotAll(all, '6-prikbord');

    // ── 7 · Tot slot, de controle ─────────────────────────────────────────────────────────────
    for (const p of all) await openWalk(p.page);
    await sendChat(B.page, "zijn we nog met z'n tweeën?");
    await sees(A, "zijn we nog met z'n tweeën?", '7');
    await C.page.waitForTimeout(6000);
    const cHasIt = (await readBubbles(C.page)).some((s) => s.includes("met z'n tweeën"));
    note('7 · C ziet het NIET', cHasIt ? 'FAIL' : 'PASS', cHasIt ? 'C ontving een bericht na verwijdering' : 'niets bij C');
    await shotAll(all, '7-slot');
  } finally {
    log('DE WANDELING — bevindingen', findings.length ? `${findings.length}` : 'geen', findings.length ? findings.join('\n    ') : 'elke stap zoals het script het beschrijft');
    await teardown(all);
  }
});
