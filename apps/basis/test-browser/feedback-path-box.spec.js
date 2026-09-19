/**
 * THE ALPHA'S FEEDBACK PATH, ON REAL SCREENS — the web app on both ends, the real box in the middle.
 *
 * What a tester does and what the maker sees, played by the actual shell: the MAKER is a web app (context A)
 * that enrols the real device runner as its always-on box, primary contact address; a VISITOR is a fresh
 * web app (context B) that has the maker's card the way the build seeds it, opens Contacten, writes to the
 * maker; the assertion is on A's SCREEN — a row for the visitor in Contacten, the text painted in its thread,
 * the seal mark reading "person" — and on the box's log, because the box is where the message lands first.
 * Then the maker answers, and B sees the answer.
 *
 * Why this exists: on 2026-09-18 the same path was proven three times at the agent layer and failed three
 * times on the shell — the book not shown in Contacten, the row naming the sharing device's key instead of
 * the address, a carried turn stored under a sender with no row. Every proof had asserted "stored"; the
 * failures were "painted". A spec that stands for a person's screen asserts what they would see.
 *
 * Arm with a local relay (the fixture starts it):
 *   PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/feedback-path-box.spec.js
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootPeer, teardown, gotoCircles, createCircle, log, sendDirectMessage, waitForContactMessageDetailed } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');
const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

const walkLog = (dir) => readdirSync(dir).filter((f) => f.startsWith('walk-log-')).flatMap((f) =>
  readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
function run(args, { env, stdin = null }) {
  const child = spawn(process.execPath, [RUNNER, ...args], { env, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const state = { child, out: '' };
  child.stdout.on('data', (b) => { state.out += String(b); });
  child.stderr.on('data', (b) => { state.out += String(b); });
  if (stdin) { child.stdin.write(stdin); child.stdin.end(); }
  state.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return state;
}
const untilOut = async (proc, needle, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (proc.out.includes(needle)) return true; await new Promise((r) => { setTimeout(r, 300); }); }
  return false;
};
const untilLog = async (dir, pred, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const hit = walkLog(dir).find(pred); if (hit) return hit; await new Promise((r) => { setTimeout(r, 500); }); }
  return null;
};

test('a visitor writes to the maker: the box takes it, the maker\'s screen shows it, the maker answers', async ({ browser }) => {
  test.setTimeout(420_000);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-feedback-browser-'));
  const env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: R1, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PRIMARY_DEVICE: '1' };
  let box = null; let maker = null; let visitor = null;
  try {
    // ── The maker's web app, with a circle (the sibling rail rides circles). ───────────────────────────
    maker = await bootPeer(browser, 'maker');
    // The maker's console, kept: when the screen does not show what the box delivered, this says why.
    const makerConsole = [];
    maker.page.on('console', (m) => { const t = m.text(); if (/contact|carry|carried|own-device|refus|unhandled|fan|turn|delegation|sibling/i.test(t) && !/NO ROSTER|strict mode|listContacts/.test(t)) makerConsole.push(t.slice(0, 220)); });
    await gotoCircles(maker.page);
    await createCircle(maker.page, 'Thuis');
    await maker.page.waitForTimeout(2000);
    log('STEP1 maker boots', 'PASS', 'a web app with one circle');

    // ── The box, enrolled from the maker's offer, started as the PRIMARY device. ──────────────────────
    const offer = await maker.page.evaluate(async (relay) => window.onderlingCall('household', 'buildEnrollOffer', { relayUrl: relay }), R1);
    expect(offer?.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await maker.page.evaluate(async () => window.onderlingCall('household', 'revealOwnerPhrase', {})))?.mnemonic;
    expect(phrase?.split(/\s+/).length).toBe(24);
    const once = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    expect(await once.exited, `--enrol did not exit cleanly:\n${once.out.slice(-1200)}`).toBe(0);
    box = run(['--data-dir', dataDir], { env });
    expect(await untilOut(box, 'device-runner: up', 90_000), `the box never came up:\n${box.out.slice(-1500)}`).toBe(true);
    const consumed = await untilLog(dataDir, (e) => e.kind === 'enroll-offer', 60_000);
    expect(consumed, 'the box never consumed the offer').toBeTruthy();
    expect(consumed.cleared, `the enrol did not complete on the box — the maker's web app must answer the seed: ${JSON.stringify(consumed.circles)}`).toBe(true);
    expect(await untilOut(box, 'primary contact address', 30_000), 'the box never claimed the primary address').toBe(true);
    const card = /onderling-contact:\/\/[A-Za-z0-9_-]+/.exec(box.out)?.[0];
    expect(card, 'the box printed no card').toBeTruthy();
    log('STEP2 the box', 'PASS', 'enrolled from the web app, primary contact address, card printed');

    // ── A visitor's fresh web app: the card the build ships with, through the path the seed takes. ──────
    visitor = await bootPeer(browser, 'visitor');
    await gotoCircles(visitor.page);
    const added = await visitor.page.evaluate(async (payload) => window.onderlingCall('stoop', 'addContactFromQr', { payload }), card);
    expect(added?.contact?.webid, JSON.stringify(added).slice(0, 300)).toBeTruthy();
    // Record every carried turn the maker's channel is handed (the wire as the box built it).
    await maker.page.evaluate(() => {
      const ch = window.onderlingContactChannel; if (!ch) return;
      window.__carriedWires = [];
      const orig = ch.applyOwnDeviceTurn.bind(ch);
      ch.applyOwnDeviceTurn = async (wire) => { window.__carriedWires.push({ ...wire, text: String(wire.text).slice(0, 40) }); return orig(wire); };
    });
    const marker = `hoi Wilfred, dit is ${Date.now().toString(36)}`;
    const sent = await sendDirectMessage(visitor.page, marker);
    expect(sent.sent, `the visitor could not write: ${sent.why}`).toBe(true);
    expect(sent.to, 'the row the visitor wrote to is the maker\'s ADDRESS (the card\'s peerAddr), not the box\'s key').toBe(added.contact.webid);
    expect(sent.sealedTo, 'sealed to the person — the card carried the person key').toBe('person');
    log('STEP3 the visitor writes', 'PASS', `to ${String(sent.to).slice(0, 12)}…, sealed to the ${sent.sealedTo}`);

    // ── The box, the primary, took it… ────────────────────────────────────────────────────────────────
    const onBox = await untilLog(dataDir, (e) => e.kind === 'contact-turn' && e.text === marker, 30_000);
    expect(onBox, `the box never recorded the visitor's message:\n${box.out.slice(-1500)}`).toBeTruthy();
    // ── …and the maker's SCREEN shows it: a row in Contacten, the text painted. ───────────────────────
    const seen = await waitForContactMessageDetailed(maker.page, marker, { tries: 12, every: 3000 });
    // What the maker's device holds, whether or not a row shows it: the peer graph and the contact DM store.
    const visitorId = (await visitor.page.evaluate(async () => window.onderlingCall('stoop', 'whoAmI', {})))?.pubKey ?? null;
    const held = await maker.page.evaluate(async ({ m, v }) => {
      const peers = await window.onderlingPeers?.all?.().catch(() => null);
      const ids = [...new Set([...(peers ?? []).map((p) => p.pubKey ?? p.id).filter(Boolean), ...(v ? [v] : [])])];
      const threads = {};
      for (const id of ids) { try { threads[id.slice(0, 12)] = ((await window.onderlingContactChannel?.rehydrate?.(id)) ?? []).map((t) => t.text).filter((t) => t.includes(m)).length; } catch { threads[id.slice(0, 12)] = 'err'; } }
      return { peers: ids.map((i) => i.slice(0, 12)), threads, visitor: v?.slice(0, 12) };
    }, { m: marker, v: visitorId }).catch((e) => ({ error: String(e) }));
    const handed = await maker.page.evaluate(() => (window.__carriedWires ?? []).map((w) => ({ direction: w.direction, contactId: String(w.contactId).slice(0, 12), fromAddr: String(w.fromAddr ?? '').slice(0, 12), text: w.text })));
    const boxSaw = walkLog(dataDir).filter((e) => e.kind === 'contact-turn' || e.kind === 'own-device-fan').slice(-3);
    // On a red, everything a reader needs to place the loss: what the box saw and fanned, what the maker's
    // channel was handed (the key the sibling used), what the maker's device holds, and its console.
    const whereItWent = () => `maker holds: ${JSON.stringify(held)}\nmaker was handed: ${JSON.stringify(handed)}\nbox saw: ${JSON.stringify(boxSaw)}\nmaker console:\n${makerConsole.slice(-24).join('\n')}`;
    expect(seen.found, `the visitor's message never reached the maker's web app —\n${whereItWent()}`).toBe(true);
    expect(seen.painted, `the message is on the maker's device but NOT ON SCREEN — a row with nothing to open it from —\n${whereItWent()}`).toBe(true);
    log('STEP4 the maker sees it', 'PASS', `row ${String(seen.contactId).slice(0, 12)}…, painted`);

    // ── The maker answers from that row; the visitor sees the answer. ───────────────────────────────────
    // What the maker's send RETURNED — the route it took, the transport's verdict, the fallback — recorded on the
    // page, because in CI this step was red with "found: false" and nothing said where the answer went.
    await maker.page.evaluate(() => {
      const ch = window.onderlingContactChannel; if (!ch) return;
      window.__sendOutcomes = [];
      const orig = ch.sendTurn.bind(ch);
      ch.sendTurn = (turn) => {
        const r = orig(turn);
        const rec = { to: String(turn.peerAddr).slice(0, 12), thread: String(turn.threadId).slice(0, 12), text: String(turn.text).slice(0, 30) };
        window.__sendOutcomes.push(rec);
        Promise.resolve(r.sent).then((out) => { rec.out = JSON.parse(JSON.stringify(out ?? null)); }, (e) => { rec.error = String(e?.message ?? e); });
        return r;
      };
    });
    const visitorConsole = [];
    visitor.page.on('console', (m) => { const t = m.text(); if (/contact|relay|secure-agent|refus|unhandled|HI|seal|pair|turn/i.test(t) && !/strict mode|listContacts/.test(t)) visitorConsole.push(t.slice(0, 220)); });
    // What the maker's Contacten offers before answering: a second person row (an own device's per-circle
    // address the resolver does not know) sorts by key bytes, and "the first person" is then a coin flip.
    await gotoCircles(maker.page);
    await maker.page.locator('[data-tab="contacten"]').first().click();
    await maker.page.waitForTimeout(1500);
    const makerRows = await maker.page.evaluate(() => [...document.querySelectorAll('.cc-contacts__row')].map((r) => `${r.dataset.contactId?.slice(0, 12)}${r.classList.contains('cc-contacts__row--bot') ? '(bot)' : ''}:${r.querySelector('.cc-contacts__name')?.textContent?.slice(0, 12)}`)).catch(() => null);
    // …and who each row IS: the visitor's keys, the box's (the maker's own) — a row that is neither is a defect of its own.
    const visitorWho = await visitor.page.evaluate(async () => { const w = await window.onderlingCall('stoop', 'whoAmI', {}); return { pubKey: String(w?.pubKey).slice(0, 12), webid: String(w?.webid).slice(0, 12), address: String(w?.address ?? w?.peerAddress ?? '').slice(0, 12) }; }).catch((e) => String(e));
    const makerGraph = await maker.page.evaluate(async () => ((await window.onderlingPeers?.all?.()) ?? []).map((p) => `${String(p.pubKey ?? p.id).slice(0, 12)}:${p.name ?? ''}:${p.reachable}`)).catch((e) => String(e));
    // …and the rosters each side holds (who, at which addresses) — an unresolved row is an address on no roster here.
    const rostersOf = async (page) => page.evaluate(async () => {
      const ids = ((await window.onderlingCall('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
      const out = {};
      for (const cid of ids) { try { const r = await window.onderlingCall('stoop', 'listGroupMembers', { groupId: cid }); out[String(cid).slice(0, 14)] = (r?.members ?? []).map((m) => `${String(m.webid).slice(0, 8)}@[${(m.circleAddresses ?? []).map((a) => String(a).slice(0, 8)).join(',')}]${m.circleAddress ? `*${String(m.circleAddress).slice(0, 8)}` : ''}`); } catch (e) { out[String(cid).slice(0, 14)] = String(e); } }
      return out;
    }).catch((e) => String(e));
    const makerRosters = await rostersOf(maker.page);
    const visitorRosters = await rostersOf(visitor.page);
    const boxPresence = walkLog(dataDir).filter((e) => e.kind === 'presence').slice(-1)[0] ?? null;
    const boxPrimary = walkLog(dataDir).filter((e) => e.kind === 'primary-device').slice(-1)[0] ?? null;
    // ONE person on the maker's Contacten: the visitor. The maker's own person-key address (which every device
    // of theirs speaks as to its siblings) used to be a second, nameless row here — sorted by key bytes, first in
    // CI — and an answer sent to it went nowhere (the STEP5 red of 2026-09-19). Asserted so it cannot come back.
    const personRows = (makerRows ?? []).filter((r) => !r.includes('(bot)'));
    expect(personRows, `the maker's Contacten lists exactly the visitor — no row for the maker's own addresses (box: ${JSON.stringify(boxPrimary)})`).toEqual([`${String(visitorWho?.webid)}:${String(visitorWho?.webid)}`]);
    const reply = `dank je, ik kijk ernaar ${Date.now().toString(36)}`;
    const answered = await sendDirectMessage(maker.page, reply, { to: seen.contactId });
    expect(answered.sent, `the maker could not answer: ${answered.why}`).toBe(true);
    log('STEP5a the maker answered', 'INFO', `to ${String(answered.to).slice(0, 12)}…; visitor ${JSON.stringify(visitorWho)}; box card → ${String(added.contact.webid).slice(0, 12)}…; Contacten rows: ${JSON.stringify(makerRows)}; graph: ${JSON.stringify(makerGraph)}\n    maker rosters: ${JSON.stringify(makerRosters)}\n    visitor rosters: ${JSON.stringify(visitorRosters)}\n    box presence: ${JSON.stringify(boxPresence)}\n    box primary: ${JSON.stringify(boxPrimary)}`);
    // The answer may ride the pair route first and reach the visitor by the fallback after that route's greeting
    // times out (~20 s in CI): the poll allows for it.
    const back = await waitForContactMessageDetailed(visitor.page, reply, { tries: 20, every: 3000 });
    if (!back.painted) {
      const outcomes = await maker.page.evaluate(() => window.__sendOutcomes ?? null).catch((e) => String(e));
      const visitorHolds = await visitor.page.evaluate(async (id) => {
        try { return ((await window.onderlingContactChannel?.rehydrate?.(id)) ?? []).map((t) => `${t.origin}:${String(t.text).slice(0, 24)}`); } catch (e) { return String(e); }
      }, added.contact.webid).catch((e) => String(e));
      const boxTail = walkLog(dataDir).slice(-6);
      console.log(`### STEP5 diagnostics\nmaker sent: ${JSON.stringify(outcomes)}\nvisitor holds (thread ${String(added.contact.webid).slice(0, 12)}): ${JSON.stringify(visitorHolds)}\nvisitor console:\n${visitorConsole.slice(-30).join('\n')}\nmaker console:\n${makerConsole.slice(-30).join('\n')}\nbox log tail: ${JSON.stringify(boxTail)}`);
    }
    expect(back.painted, `the maker's answer never reached the visitor's screen (found: ${back.found}) — see "STEP5 diagnostics" above`).toBe(true);
    log('STEP5 the answer', 'PASS', 'round trip complete');

    // ── The visitor hides Wilfred; the maker answers again; Wilfred is back, with the marker. (L106) ─────
    // The seeded contact is the first row every tester will want out of their list. Hidden, not deleted: the
    // thread stays, the fold at the bottom says "verborgen (1)", and the next message FROM them brings them
    // back — with the one line that says why they are back. Painted, not stored.
    await gotoCircles(visitor.page);
    await visitor.page.locator('[data-tab="contacten"]').first().click();
    await visitor.page.waitForTimeout(1500);
    await visitor.page.locator(`.cc-contacts__row[data-contact-id="${added.contact.webid}"]`).first().click();
    await visitor.page.waitForTimeout(1500);
    const hide = visitor.page.locator('.cc-cthread__hide');
    expect(await hide.count(), 'the thread header offers Verbergen for a person').toBe(1);
    expect(await hide.getAttribute('data-hidden')).toBe('false');
    await hide.click();
    await expect(hide, 'the control flips to Tonen once the book has the mark').toHaveAttribute('data-hidden', 'true');
    await visitor.page.locator('.cc-cthread__back').first().click();
    await visitor.page.waitForTimeout(1500);
    const shownRows = visitor.page.locator(`.cc-contacts__list:not(.cc-contacts__hidden) .cc-contacts__row[data-contact-id="${added.contact.webid}"]`);
    expect(await shownRows.count(), 'Wilfred is not in the list any more').toBe(0);
    const fold = visitor.page.locator('.cc-contacts__fold');
    expect(await fold.count(), 'the fold at the bottom holds the hidden row').toBe(1);
    expect(await fold.textContent()).toContain('1');
    log('STEP6a the visitor hides Wilfred', 'PASS', `fold: ${(await fold.textContent()).trim()}`);
    const again = `nog even dit ${Date.now().toString(36)}`;
    const answered2 = await sendDirectMessage(maker.page, again, { to: seen.contactId });
    expect(answered2.sent, `the maker could not answer a second time: ${answered2.why}`).toBe(true);
    const returned = await waitForContactMessageDetailed(visitor.page, again, { tries: 12, every: 3000 });
    expect(returned.painted, `the second answer never reached the visitor's screen (found: ${returned.found}) — a hidden contact's message must land and bring them back`).toBe(true);
    // The thread that is open now is Wilfred's: the marker sits above the turn that brought him back.
    const returnedLine = visitor.page.locator('.cc-cthread__system');
    expect(await returnedLine.count(), 'the one-line marker ("Je had dit contact verborgen.") is painted once').toBe(1);
    const markerThenTurn = await visitor.page.evaluate((t) => {
      const sys = document.querySelector('.cc-cthread__system');
      return !!sys && (sys.nextElementSibling?.textContent ?? '').includes(t);
    }, again);
    expect(markerThenTurn, 'the marker sits right above the turn that brought Wilfred back').toBe(true);
    expect(await visitor.page.locator('.cc-cthread__hide').getAttribute('data-hidden'), 'the header reads Verbergen again').toBe('false');
    await visitor.page.locator('.cc-cthread__back').first().click();
    await visitor.page.waitForTimeout(1500);
    expect(await shownRows.count(), 'Wilfred is a row in the list again').toBe(1);
    expect(await visitor.page.locator('.cc-contacts__fold').count(), 'nothing hidden any more — no fold').toBe(0);
    log('STEP6 hidden, then back', 'PASS', 'the marker is painted above the returning turn');
  } finally {
    try { box?.child?.kill('SIGTERM'); } catch { /* */ }
    await teardown([maker, visitor].filter(Boolean));
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
