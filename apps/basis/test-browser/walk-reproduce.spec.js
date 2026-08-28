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
        ? `both devices call it "${aId}" — two unrelated circles share an identity`
        : `A=${aId} B=${bId} — distinct, as they should be`);
    // Two unrelated people naming a circle the same thing must not end up in one circle. Names are
    // public and often obvious ("buurt"), so a name-derived id is a second door into someone's roster.
    expect(aId, 'two unrelated circles must not share an identity').not.toBe(bId);
    expect(aId, 'and the id must not be derivable from the name anyone can guess').not.toMatch(/proeftuin/i);
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
      entries.map((e) => `${e.opId}(${(e.needsArgs ?? []).join(',') || 'no args'})[${e.state ?? 'no-verdict'}${e.unavailable ? ':' + e.unavailable : ''}]`).join(' · ') || 'nothing offered');
    log('surface apps', 'OBSERVED', `apps=${(s?.apps ?? []).join(',')} actions=${(s?.actions ?? []).length}`);

    // The dead-end Frits hit: an entry whose op needs arguments, tapped with none. Whether the shell
    // raises a form for them is the question — an entry that cannot ask is an entry that cannot work.
    // Tap them for real and read what the circle says back. `dispatchReady` has exactly one path to
    // "I couldn't turn that into an action" (`circle.bot.unknown`): `resolveDispatch` THROWING, i.e.
    // the op is not in this circle's catalogue. Every other outcome is a prompt or a form.
    const before = await readBubbles(A.page);
    for (const e of entries) {
      if (e.opId === 'embed-file') continue;            // routes through the media pipeline, not dispatch
      await dispatch(A.page, e.opId, {});
      await A.page.waitForTimeout(2500);
    }
    const said = (await readBubbles(A.page)).filter((t) => !before.includes(t));
    log('what a tap actually says', said.length ? 'OBSERVED' : 'FINDING',
      JSON.stringify(said.slice(0, 4)));

    const needy = entries.filter((e) => (e.needsArgs ?? []).length);
    log('entries needing a form', needy.length ? 'OBSERVED' : 'PASS',
      needy.map((e) => `${e.opId} needs ${e.needsArgs.join('+')}`).join(' · ') || 'none need arguments');
    expect(Array.isArray(entries), 'the attach menu must be readable as data').toBe(true);
  } finally { await teardown(peers); }
});

test('RC1a — the two roster reads must agree about who is in the circle', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Eens Kring', re: /eens.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);
    const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;

    // THE DIFFERENCE ONLY SHOWS AFTER A SPINE EVENT. On a fresh circle the two agree, because the
    // founder's absence from the narrow read is just CALLER EXCLUSION — which is why comparing them
    // without accounting for it made me report a disagreement that was not there (2026-08-27).
    // `deriveRoster` folds the membership spine; `listCircleRoster` reads redemption rows only. So the
    // question is what each says after a ROLE CHANGE, which exists only on the spine.
    const bWebid = ((await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid }))?.members ?? [])
      .find((m) => m.role !== 'admin')?.webid ?? null;
    await call(A.page, 'stoop', 'setMemberRole', { groupId: gid, memberWebid: bWebid, role: 'admin' });
    await A.page.waitForTimeout(8000);

    const roster  = await call(A.page, 'stoop', 'listGroupRoster',  { groupId: gid });
    const members = await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid });

    // `listGroupRoster` answers the narrow `{addr, role}` question and EXCLUDES the caller — that
    // exclusion is load-bearing (personaPropsUpdate reads "no admin in the list" as "the admin is me").
    // Everything else about the two answers must match, because they answer the same question about the
    // same circle on the same device, and `catchUp` picks the peers it asks from the narrow one.
    const narrow = new Map((roster?.members ?? []).map((m) => [m.addr, m.role]));
    const rich   = new Map((members?.members ?? []).filter((m) => m.webid !== me).map((m) => [m.webid, m.role]));

    log('RC1a comparison', 'OBSERVED',
      `narrow=${JSON.stringify([...narrow])} rich(minus caller)=${JSON.stringify([...rich])}`);

    expect([...narrow.keys()].sort(), 'the two roster reads must contain the same people')
      .toEqual([...rich.keys()].sort());
    for (const [who, role] of rich) {
      expect(narrow.get(who), `role disagreement for ${String(who).slice(0, 8)}`).toBe(role);
    }
  } finally { await teardown(peers); }
});

test('L51 — a removed member is told, on their own screen', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Bericht Kring', re: /bericht.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    await openCircleMatching(B.page, /bericht.?kring/i);
    await toChat(B.page);
    const gid = await activeCircle(A.page);

    // Say something first: the notice PROMISES their history stays theirs, so the test has to hold the
    // promise to account rather than only checking that the sentence appears.
    await toChat(A.page);
    await sendChat(A.page, 'HISTORIE-VOOR-VERWIJDERING');
    await B.page.waitForTimeout(6000);
    await toChat(B.page);

    const before = await readBubbles(B.page);
    const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const bWebid = ((await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid }))?.members ?? [])
      .map((m) => m.webid).find((w) => w !== me);

    await call(A.page, 'stoop', 'removeMember', { groupId: gid, memberWebid: bWebid, reason: 'walk' });
    await B.page.waitForTimeout(12000);
    await toChat(B.page);

    // Take the roster path the notice hangs off, the way a person glancing at the member list would.
    // No reload: whether the circle still OPENS after a removal is a separate question, and using it
    // here would confuse "we never told them" with "they could not get back in to be told".
    const diag = [];
    B.page.on('console', (m) => { const t = m.text(); if (/removal DIAG/i.test(t)) diag.push(t.slice(0, 300)); });
    const membersTab = B.page.locator('.circle-view__tab[data-tab="members"]');
    log('members tab reachable', (await membersTab.count()) ? 'PASS' : 'BLOCKED', String(await membersTab.count()));
    if (await membersTab.count()) { await membersTab.first().click(); await B.page.waitForTimeout(6000); }
    // BACK TO THE CONVERSATION TAB. `toChat` toggles the view MODE (chat vs screen), not the tab — so
    // after visiting members it leaves you on members, and every bubble read there is empty. That read
    // as "the removed member lost their whole history", which would have been a serious and false
    // finding about a decision Frits had just made the other way.
    const convTab = B.page.locator('.circle-view__tab[data-tab="conversation"]');
    if (await convTab.count()) { await convTab.first().click(); await B.page.waitForTimeout(2500); }
    await toChat(B.page);
    log('B removal diagnostics', 'OBSERVED', diag.slice(0, 4).join(' | ') || '(none — the notice path never ran)');

    const after = await readBubbles(B.page);
    const fresh = after.filter((t) => !before.includes(t));
    log('L51 notice', fresh.length ? 'PASS' : 'FINDING', JSON.stringify(fresh));
    log('B all bubbles', 'OBSERVED', JSON.stringify(after.slice(0, 6)));
    const dom = await B.page.evaluate(() => ({
      bubbles: document.querySelectorAll('.circle-view__bubble').length,
      texts: [...document.querySelectorAll('.circle-view__bubble')].map((e) => e.textContent.slice(0, 60)).slice(0, 6),
    }));
    log('B DOM bubbles', 'OBSERVED', JSON.stringify(dom));

    // The statement now arrives and folds (the roster on their own device drops them). What must follow
    // is that their SCREEN says so — Frits' rule: never change anything silently.
    expect(fresh.length, 'a removed member must be told, in the circle, on their own device')
      .toBeGreaterThan(0);

    // Decided 2026-08-28 (the enforceability rule): nothing is taken away. A read-restriction would be
    // a costume — the data is already on their disk — and the gate that binds is the key rotation.
    const keptHistory = after.some((t) => /HISTORIE-VOOR-VERWIJDERING/.test(t));
    log('history kept after removal', keptHistory ? 'PASS' : 'FINDING',
      keptHistory ? 'what was already there is still readable' : 'the message they had is GONE — the notice promises otherwise');
    expect(keptHistory, 'their history stays theirs — the notice says so in as many words').toBe(true);
  } finally { await teardown(peers); }
});
