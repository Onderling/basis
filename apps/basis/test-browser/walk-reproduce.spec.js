/**
 * walk-reproduce.spec.js — every issue Frits and I found by hand on 2026-08-27, re-run against the
 * REAL app, by the walk seam, with no human at a screen.
 *
 * The hand-walk found these with two devices and a lot of typing; three of my diagnoses of them then
 * turned out to be my harness rather than the product. This file exists so the question "is it still
 * broken?" is a command rather than an afternoon — and so a fix has something that goes green.
 *
 * Each test logs OBSERVED / FINDING / PASS and asserts as little as possible: the point is evidence,
 * not a red suite. A FINDING line is the deliverable.
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, toChat, sendChat, readBubbles, log,
  gotoCircles, createCircle, openCircleMatching } from './peerHarness.js';

test.setTimeout(420_000);

const surface  = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call     = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const dispatch = (page, opId, args = {}) =>
  page.evaluate(([o, a]) => window.onderlingDispatch?.(o, a), [opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;
const roles = (r) => (r?.members ?? []).map((m) => `${String(m.webid).slice(0, 8)}=${m.role}${m.adminVia ? '/' + m.adminVia : ''}`);

test('5f.3 — does a role change reach the other device?', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const p = await pair(A, B, { name: 'Rol Kring', re: /rol.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    await openCircleMatching(B.page, /rol.?kring/i);
    const gid = await activeCircle(A.page);

    const before = await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid });
    const bWebid = (before?.members ?? []).find((m) => m.role !== 'admin')?.webid ?? null;
    log('before', 'OBSERVED', `A sees ${JSON.stringify(roles(before))}`);

    const r = await call(A.page, 'stoop', 'setMemberRole', { groupId: gid, memberWebid: bWebid, role: 'admin' });
    log('setMemberRole', 'OBSERVED', JSON.stringify(r)?.slice(0, 120));
    await A.page.waitForTimeout(12000);

    const aAfter = await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid });
    const bAfter = await call(B.page, 'stoop', 'listGroupMembers', { groupId: gid });
    log('A after', 'OBSERVED', JSON.stringify(roles(aAfter)));
    log('B after', 'OBSERVED', JSON.stringify(roles(bAfter)));

    // The real question: can B now DO what an admin does?
    const bCan = await call(B.page, 'stoop', 'getCurrentMembershipCode', { groupId: gid });
    log('promoted peer can act as admin', bCan?.error ? 'FINDING' : 'PASS',
      bCan?.error ? `refused: ${bCan.error} — the promotion did not reach them` : 'yes');
  } finally { await teardown(peers); }
});

test('DG1 — is an evicted member told, and can they still type into the circle?', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const p = await pair(A, B, { name: 'Weg Kring', re: /weg.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    await openCircleMatching(B.page, /weg.?kring/i);
    await toChat(B.page);
    const gid = await activeCircle(A.page);

    await toChat(A.page);
    await sendChat(A.page, 'VOOR-DE-VERWIJDERING');
    await B.page.waitForTimeout(6000);
    const pre = await readBubbles(B.page);
    log('baseline', pre.some((t) => /VOOR-DE/.test(t)) ? 'PASS' : 'BLOCKED', `B sees ${pre.length} bubble(s)`);

    // Does A even HOLD a per-circle address for B? The fan's refusal (`blocked-by-setting`) means
    // "no circle address and the global-key fallback is off" — so the question is which half is true.
    const rosterRows = (await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid }))?.members ?? [];
    log('addresses A holds', 'OBSERVED', JSON.stringify(rosterRows.map((m) => ({
      who: String(m.webid).slice(0, 8), addr: m.circleAddress ? String(m.circleAddress).slice(0, 10) : null,
      proof: typeof m.circleAddressProof === 'string' && !!m.circleAddressProof,
    }))));

    const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const bWebid = ((await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid }))?.members ?? [])
      .map((m) => m.webid).find((w) => w !== me);
    // Capture BOTH sides across the eviction. `alsoTo: [evictedSubject]` says the removed member is
    // meant to be told; if they are not, the answer is in one of these two logs.
    const aLog = []; const bLog = [];
    const grab = (into) => (m) => { const t = m.text(); if (/membership|evict|seal|refus|rotat|key|drop|hold|DIAG/i.test(t)) into.push(t.slice(0, 300)); };
    A.page.on('console', grab(aLog)); B.page.on('console', grab(bLog));

    const ev = await call(A.page, 'stoop', 'removeMember', { groupId: gid, memberWebid: bWebid, reason: 'walk' });
    log('removeMember', 'OBSERVED', JSON.stringify(ev)?.slice(0, 140));
    await B.page.waitForTimeout(12000);

    // 1 · was B told?
    const told = await readBubbles(B.page);
    const newLines = told.filter((t) => !pre.includes(t));
    log('was the removed member TOLD?', newLines.length ? 'PASS' : 'FINDING',
      newLines.length ? JSON.stringify(newLines) : 'nothing new appeared on their screen');

    // 2 · does their own app still show them as a member?
    const bView = await call(B.page, 'stoop', 'listGroupMembers', { groupId: gid });
    log('B still sees a roster?', (bView?.members ?? []).length ? 'FINDING' : 'PASS',
      JSON.stringify(roles(bView)));

    // 3 · can they still type, and does it go anywhere?
    await toChat(B.page);
    await sendChat(B.page, 'IK-BEN-VERWIJDERD-EN-TYP-NOG');
    await A.page.waitForTimeout(8000);
    await toChat(A.page);
    const aGot = await readBubbles(A.page);
    log('does a removed member reach the circle?', aGot.some((t) => /VERWIJDERD-EN-TYP/.test(t)) ? 'FINDING' : 'PASS',
      aGot.some((t) => /VERWIJDERD-EN-TYP/.test(t)) ? 'their message ARRIVED — forward secrecy broken' : 'no — the island holds');

    log('A console across the eviction', 'OBSERVED', aLog.slice(0, 8).join(' | ') || '(nothing)');
    log('B console across the eviction', 'OBSERVED', bLog.slice(0, 8).join(' | ') || '(nothing)');

    // 4 · and what did their own device claim about that send?
    const surf = await surface(B.page);
    log('B\'s surface after eviction', 'OBSERVED', `circle=${surf?.where?.circleId} nav=[${(surf?.nav ?? []).map((n) => n.id).join(',')}]`);
  } finally { await teardown(peers); }
});

test('O17 — does something posted on the noticeboard reach the other device?', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    // `createCircle` needs the LAUNCHER. The earlier run timed out on `.circle-launcher__new` with no
    // explanation, because nothing checked we were there first — a harness that cannot say where it is
    // reports a product failure for its own navigation.
    await gotoCircles(A.page);
    const onLauncher = await A.page.locator('.circle-launcher__new').count();
    log('A is on the launcher', onLauncher ? 'PASS' : 'BLOCKED', `new-circle button: ${onLauncher}`);
    test.skip(!onLauncher, 'not on the launcher — the wizard is unreachable from here');

    const p = await pair(A, B, { name: 'Bord Kring', re: /bord.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    await openCircleMatching(B.page, /bord.?kring/i);

    const add = await call(A.page, 'household', 'addItem', { type: 'shopping', text: 'BOORMACHINE' });
    log('addItem', 'OBSERVED', JSON.stringify(add)?.slice(0, 160));
    await B.page.waitForTimeout(12000);

    const aList = await call(A.page, 'household', 'listOpen', { type: 'shopping' });
    const bList = await call(B.page, 'household', 'listOpen', { type: 'shopping' });
    const aTexts = (aList?.items ?? []).map((i) => i.text);
    const bTexts = (bList?.items ?? []).map((i) => i.text);
    log('item crossed?', bTexts.some((t) => /BOORMACHINE/.test(t)) ? 'PASS' : 'FINDING',
      `A=${JSON.stringify(aTexts)} B=${JSON.stringify(bTexts)}`);
  } finally { await teardown(peers); }
});

test('L49 — two people naming a circle the same thing', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    for (const [peer, label] of [[A, 'A'], [B, 'B']]) {
      await gotoCircles(peer.page);
      await createCircle(peer.page, 'Proeftuin');
      await openCircleMatching(peer.page, /proeftuin/i);
    }
    const aId = await activeCircle(A.page);
    const bId = await activeCircle(B.page);
    log('circle ids for the same NAME', aId === bId ? 'FINDING' : 'PASS',
      aId === bId
        ? `both devices call it "${aId}" — two unrelated circles share an identity (L49)`
        : `A=${aId} B=${bId} — distinct, as they should be`);
  } finally { await teardown(peers); }
});

test('5f.7 — the attach menu (Card / Appointment)', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    await gotoCircles(A.page);
    await createCircle(A.page, 'Bijlage Kring');
    await openCircleMatching(A.page, /bijlage.?kring/i);
    await toChat(A.page);

    // Read the menu instead of guessing at it. Dispatching a bare `embed` was the wrong instrument:
    // these are attach entries with required params, not zero-arg ops, so a bare call proves nothing.
    const s = await surface(A.page);
    const entries = s?.attach ?? [];
    log('attach menu', entries.length ? 'OBSERVED' : 'FINDING',
      entries.map((e) => `${e.opId}(${(e.needsArgs ?? []).join(',') || 'no args'})${e.missingOp ? ' MISSING-OP' : ''}`).join(' · ') || 'nothing offered');

    // The dead-end Frits hit: an entry whose op needs arguments, tapped with none. Whether the shell
    // raises a form for them is the question — an entry that cannot ask is an entry that cannot work.
    const needy = entries.filter((e) => (e.needsArgs ?? []).length);
    log('entries needing a form', needy.length ? 'OBSERVED' : 'PASS',
      needy.map((e) => `${e.opId} needs ${e.needsArgs.join('+')}`).join(' · ') || 'none need arguments');
    expect(Array.isArray(entries), 'the attach menu must be readable as data').toBe(true);
  } finally { await teardown(peers); }
});
