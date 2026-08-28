/**
 * walk-stories.spec.js — the walk stories nobody has done yet, driven by the seam instead of by a person.
 *
 * `plans/WALK-one-story-per-category.md` gave Frits nine stories. Stories 1, 2, 3, 5 and 6 were walked by
 * hand on 2026-08-27 and produced most of this week's fixes. These are the three that were never done:
 *
 *   4 · asking the street for something   (the noticeboard, end to end)
 *   7 · the same person, two circles      (scope + unlinkability)
 *   9 · when the infrastructure fails     (the relay goes away mid-conversation)
 *
 * They are written to REPORT rather than to be green: a story's value is the sentence it produces, and
 * asserting hard on a surface nobody has walked would turn a finding into a red build with no reader.
 * Each step says PASS / FINDING / OBSERVED, and only the baselines that everything downstream depends on
 * are asserted — if the baseline fails the rest is measuring nothing, which is worth failing loudly.
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, toChat, sendChat, readBubbles, log,
  gotoCircles, createCircle, openCircleMatching, joinFromInvite } from './peerHarness.js';

test.setTimeout(420_000);

const surface  = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call     = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;

/**
 * Wait until the app can answer for itself. `window.onderlingCall` exists before the agent behind it
 * does, so an early probe returns `undefined` — which reads exactly like "this person has no identity"
 * and is really "the app has not finished booting". Two very different findings, one value.
 */
async function waitForAgent(page, { tries = 30, every = 1000 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const me = await page.evaluate(() => window.onderlingCall?.('stoop', 'whoAmI', {})).catch(() => null);
    if (me?.webid) return me;
    await page.waitForTimeout(every);
  }
  return null;
}
const tab = (page, id) => page.locator(`.circle-view__tab[data-tab="${id}"]`);

test('story 4 — asking the circle for something', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Prikbord Kring', re: /prikbord.?kring/i });
    test.skip(!p.joined, 'pairing failed — nothing downstream is measurable');
    await openCircleMatching(B.page, /prikbord.?kring/i);
    const gid = await activeCircle(A.page);

    // Is there a noticeboard at all? A tab exists only when the circle's policy switches the feature on,
    // which is itself the first thing a person would discover.
    const hasTab = await tab(A.page, 'noticeboard').count();
    log('story 4 · is there a noticeboard?', hasTab ? 'PASS' : 'FINDING',
      hasTab ? 'the tab is there' : 'no noticeboard tab — the feature is off for a fresh circle');

    // What does the app offer for putting something ON it? Read, do not guess.
    const s = await surface(A.page);
    const posting = (s?.actions ?? []).filter((a) => /post|offer|announce|ask/i.test(a.opId));
    log('story 4 · ops for posting', posting.length ? 'OBSERVED' : 'FINDING',
      posting.map((a) => `${a.opId}${a.needsArgs ? '*' : ''}${a.unavailable ? ':' + a.unavailable : ''}`).join(' · ') || 'nothing offered');

    // Ask for something, the way the story does.
    const asked = await call(A.page, 'stoop', 'postAnnouncement', { groupId: gid, text: 'Heeft iemand een boormachine?' });
    log('story 4 · A asks the circle', asked?.error ? 'FINDING' : 'OBSERVED', JSON.stringify(asked)?.slice(0, 160));

    await B.page.waitForTimeout(9000);
    // WHICH circle is B standing in? The items below came back looking like the help circle's, and
    // "the announcement did not fan" and "I read the wrong circle" are different findings.
    const bWhere = await activeCircle(B.page);
    log('story 4 · B is standing in', bWhere === gid ? 'PASS' : 'BLOCKED', `B=${bWhere} vs A=${gid}`);
    // Read it the way a PERSON does: open the noticeboard tab. Two ops looked plausible from outside
    // and both misled — `listOpen` through the raw seam is not circle-scoped (it answered with the help
    // circle's items), and `listCirclePostsSince` is the catch-up read, not the board. The shell scopes
    // `listOpen` through `stoopCall`, so the only honest instrument is the screen itself.
    const boardText = async (page) => {
      const t = page.locator('.circle-view__tab[data-tab="noticeboard"]');
      if (await t.count()) { await t.first().click(); await page.waitForTimeout(2500); }
      return page.evaluate(() => document.body.innerText.slice(0, 4000));
    };
    const aBoard = await boardText(A.page);
    const bBoard = await boardText(B.page);
    // Does the circle show its NAME or its id? The id used to be a slug of the name, so a fallback to
    // the id looked like a name and nobody noticed the name was never carried.
    const titleOf = (page) => page.evaluate(() => document.querySelector('.circle-view__title')?.textContent ?? '');
    const aTitle = await titleOf(A.page); const bTitle = await titleOf(B.page);
    // Where would the joiner LEARN the name? The rules item carries it on the creator's device; the
    // question is whether the joiner holds those rules at all, or whether the name simply never travels.
    const aRules = await call(A.page, 'stoop', 'getGroupRules', { groupId: gid });
    const bRules = await call(B.page, 'stoop', 'getGroupRules', { groupId: gid });
    log('story 4 · does the joiner hold the circle rules?', 'OBSERVED',
      `creator: ${JSON.stringify(aRules)?.slice(0, 90)} | joiner: ${JSON.stringify(bRules)?.slice(0, 90)}`);
    log('story 4 · does the circle show its NAME?',
      /prikbord/i.test(aTitle) && /prikbord/i.test(bTitle) ? 'PASS' : 'FINDING',
      `creator sees "${aTitle}" · joiner sees "${bTitle}"`);
    const bSees = { onScreen: /boormachine/i.test(bBoard) };
    const aSees = { onScreen: /boormachine/i.test(aBoard) };
    log('story 4 · does the ASKER see their own ask?', aSees.onScreen ? 'PASS' : 'FINDING',
      aSees.onScreen ? 'it is on their noticeboard' : `not on their own board — the board shows: ${aBoard.replace(/\s+/g, ' ').slice(0, 160)}`);
    log('story 4 · does it reach the other person?', bSees.onScreen ? 'PASS' : 'FINDING',
      bSees.onScreen ? 'it is on their board too' : `not on their board — it shows: ${bBoard.replace(/\s+/g, ' ').slice(0, 160)}`);

    // And can they respond to it — the half that makes it a conversation rather than a broadcast?
    const bSurface = await surface(B.page, [{ id: 'p1', type: 'post', label: 'boormachine' }]);
    log('story 4 · what a post OFFERS the reader', 'OBSERVED',
      (bSurface?.rows ?? []).map((r) => `${r.type ?? '?'}:[${r.actions.map((a) => a.opId).join(',') || 'nothing'}]`).join(' · ') || 'no rows');
  } finally { await teardown(peers); }
});

test('story 7 — the same person, two circles', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    // A is in both; B is in only the first. Nothing of the second may reach B, and the relay must not be
    // able to tell that one person holds both.
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Straat Kring', re: /straat.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    const shared = await activeCircle(A.page);

    await gotoCircles(A.page);
    await createCircle(A.page, 'Prive Kring');
    await openCircleMatching(A.page, /prive.?kring/i);
    const priv = await activeCircle(A.page);
    log('story 7 · two circles', priv && shared && priv !== shared ? 'PASS' : 'FINDING', `shared=${shared} private=${priv}`);

    await toChat(A.page);
    await sendChat(A.page, 'IETS-PRIVES-IN-DE-TWEEDE-KRING');
    await A.page.waitForTimeout(6000);

    // 1 · nothing of the private circle may appear in the shared one, on B's device
    await openCircleMatching(B.page, /straat.?kring/i);
    await toChat(B.page);
    const bBubbles = await readBubbles(B.page);
    const leaked = bBubbles.some((t) => /IETS-PRIVES/.test(t));
    log('story 7 · does the other circle leak into this one?', leaked ? 'FINDING' : 'PASS',
      leaked ? 'a private message appeared in the shared circle' : 'nothing crossed');
    expect(leaked, 'a message from another circle must never appear here').toBe(false);

    // 2 · B must not be able to read the private circle's roster at all
    const foreign = await call(B.page, 'stoop', 'listGroupRoster', { groupId: priv });
    const gotRoster = Array.isArray(foreign?.members) && foreign.members.length > 0;
    log('story 7 · can a non-member read the other roster?', gotRoster ? 'FINDING' : 'PASS',
      JSON.stringify(foreign)?.slice(0, 160));

    // 3 · unlinkability — A's address must differ per circle, or the relay can join them up
    const inShared = await call(A.page, 'stoop', 'listGroupMembers', { groupId: shared });
    const inPriv   = await call(A.page, 'stoop', 'listGroupMembers', { groupId: priv });
    const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const addrIn = (r) => (r?.members ?? []).find((m) => m.webid === me)?.circleAddress ?? null;
    const a1 = addrIn(inShared); const a2 = addrIn(inPriv);
    log('story 7 · one person, two circle addresses', (a1 && a2 && a1 !== a2) ? 'PASS' : 'FINDING',
      `shared=${String(a1).slice(0, 12)} private=${String(a2).slice(0, 12)}`);
  } finally { await teardown(peers); }
});

test('story 9 — the infrastructure goes away mid-conversation', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Relay Kring', re: /relay.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    await openCircleMatching(B.page, /relay.?kring/i);
    await toChat(B.page);
    await toChat(A.page);

    await sendChat(A.page, 'VOOR-DE-STORING');
    await B.page.waitForTimeout(6000);
    const before = await readBubbles(B.page);
    expect(before.some((t) => /VOOR-DE-STORING/.test(t)), 'the baseline must cross').toBe(true);
    log('story 9 · baseline', 'PASS', 'a live send arrives');

    // The network goes away for BOTH — the honest shape of "the relay is gone", rather than one peer
    // being offline (which story 3 already covered).
    await A.context.setOffline(true);
    await B.context.setOffline(true);
    await A.page.waitForTimeout(3000);

    await sendChat(A.page, 'TIJDENS-DE-STORING');
    await A.page.waitForTimeout(6000);

    // Does A's own screen say anything true about a message it cannot possibly have delivered?
    const aDuring = await A.page.evaluate(() => [...document.querySelectorAll('.circle-view__bubble')]
      .map((e) => ({ text: e.textContent.slice(0, 40),
                     delivery: e.querySelector('.circle-view__bubble-delivery')?.dataset.deliveryState ?? null })));
    const stormy = aDuring.find((b) => /TIJDENS/.test(b.text));
    log('story 9 · what the SENDER says while the network is gone', 'OBSERVED',
      JSON.stringify(stormy ?? 'the message is not even on screen'));
    log('story 9 · does anything say the circle is unreachable?', stormy?.delivery ? 'PASS' : 'FINDING',
      stormy?.delivery ? `the bubble says "${stormy.delivery}"` : 'no delivery state on the bubble at all');

    // …and does it recover on its own, or does it need a restart?
    await A.context.setOffline(false);
    await B.context.setOffline(false);
    await A.page.waitForTimeout(20000);
    await toChat(B.page);
    const after = await readBubbles(B.page);
    const arrived = after.some((t) => /TIJDENS-DE-STORING/.test(t));
    log('story 9 · does it recover without a restart?', arrived ? 'PASS' : 'FINDING',
      arrived ? 'the held message arrived once the network returned' : 'the message never arrived');

    const aAfter = await A.page.evaluate(() => [...document.querySelectorAll('.circle-view__bubble')]
      .map((e) => ({ text: e.textContent.slice(0, 40),
                     delivery: e.querySelector('.circle-view__bubble-delivery')?.dataset.deliveryState ?? null })));
    log('story 9 · and what the sender says afterwards', 'OBSERVED',
      JSON.stringify(aAfter.find((b) => /TIJDENS/.test(b.text)) ?? 'gone'));
  } finally { await teardown(peers); }
});

test('story 1 — the very first minutes, and are you still you afterwards?', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    // A fresh profile: what does a person HAVE before they have done anything?
    const before = await waitForAgent(A.page);
    log('story 1 · you have an identity without asking for one', before?.webid ? 'PASS' : 'FINDING',
      JSON.stringify(before)?.slice(0, 120));
    if (!before?.webid) {
      // "No identity" and "the app is waiting for something from you" look identical from outside, and
      // the difference is the whole of this story: one is broken, the other is onboarding.
      const seen = await A.page.evaluate(() => ({
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
        modal: !!document.querySelector('.cc-mydata-modal, .cc-wizard, [role="dialog"]'),
        seam: typeof window.onderlingCall,
      }));
      log('story 1 · what is the app WAITING for?', 'OBSERVED', JSON.stringify(seen));
    }

    const mine = await call(A.page, 'stoop', 'listMyCircles', {});
    log('story 1 · what a fresh profile already contains', 'OBSERVED', JSON.stringify(mine)?.slice(0, 180));

    // Were they told about a recovery phrase, or shown one, or neither? The story's sharpest finding.
    const s = await surface(A.page);
    const custody = (s?.actions ?? []).filter((a) => /mnemonic|backup|restore/i.test(a.opId));
    log('story 1 · custody affordances offered', custody.length ? 'OBSERVED' : 'FINDING',
      custody.map((a) => a.opId).join(' · ') || 'none offered on this surface');

    // Close the tab entirely and come back — the story's actual question.
    const idBefore = before?.webid ?? null;
    await A.page.goto('about:blank');
    await A.page.waitForTimeout(1500);
    await A.page.goto('/');
    await A.page.waitForTimeout(9000);
    const after = await waitForAgent(A.page);
    log('story 1 · are you still you after a reopen?', after?.webid && after.webid === idBefore ? 'PASS' : 'FINDING',
      `before=${String(idBefore).slice(0, 12)} after=${String(after?.webid).slice(0, 12)}`);
    expect(after?.webid, 'an identity that does not survive a reopen is not an identity').toBe(idBefore);

    const circlesAfter = await call(A.page, 'stoop', 'listMyCircles', {});
    log('story 1 · and is your stuff still there?',
      JSON.stringify(circlesAfter?.circles) === JSON.stringify(mine?.circles) ? 'PASS' : 'FINDING',
      `${JSON.stringify(mine?.circles)} → ${JSON.stringify(circlesAfter?.circles)}`);
  } finally { await teardown(peers); }
});

test('story 5 — handing a circle over, and the last admin walking out', async ({ browser }) => {
  const peers = await bootPeers(browser, 3);
  const [A, B, C] = peers;
  try {
    await gotoCircles(A.page);
    const p1 = await pair(A, B, { name: 'Overdracht Kring', re: /overdracht.?kring/i });
    test.skip(!p1.joined, 'first join failed');
    // A third member, so "the last admin leaves" has somewhere to land.
    // The third member joins the same way the second did — through the harness's own join flow rather
    // than a hand-rolled copy of it. My copy timed out on the launcher's join button, which is the sort
    // of thing that reads as a product failure and is a second implementation of a solved step.
    await gotoCircles(C.page);          // `joinFromInvite` starts FROM the launcher — my edit had dropped this
    const joined3 = await joinFromInvite(C.page, p1.inviteUri, { handle: 'derde', tag: 'story5-C' });
    log('story 5 · a third person joins', joined3?.joined ? 'PASS' : 'BLOCKED', JSON.stringify(joined3));
    await C.page.waitForTimeout(6000);

    const gid = await activeCircle(A.page);
    const roster = await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid });
    const who = (roster?.members ?? []).map((m) => `${String(m.webid).slice(0, 8)}=${m.role}${m.adminVia ? '/' + m.adminVia : ''}`);
    log('story 5 · three in the circle?', (roster?.members ?? []).length >= 2 ? 'OBSERVED' : 'BLOCKED', JSON.stringify(who));

    // Hand it over: make someone else an admin, then step back yourself.
    const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const other = (roster?.members ?? []).find((m) => m.webid !== me && m.role !== 'admin')?.webid ?? null;
    const promoted = await call(A.page, 'stoop', 'setMemberRole', { groupId: gid, memberWebid: other, role: 'admin' });
    log('story 5 · promote someone else', promoted?.error ? 'FINDING' : 'PASS', JSON.stringify(promoted)?.slice(0, 100));
    await A.page.waitForTimeout(8000);

    const stepBack = await call(A.page, 'stoop', 'setMemberRole', { groupId: gid, memberWebid: me, role: 'member' });
    log('story 5 · and step back yourself', stepBack?.error ? 'FINDING' : 'PASS', JSON.stringify(stepBack)?.slice(0, 100));
    await A.page.waitForTimeout(8000);

    for (const [peer, label] of [[A, 'A(was admin)'], [B, 'B'], [C, 'C']]) {
      const r = await call(peer.page, 'stoop', 'listGroupMembers', { groupId: gid });
      log(`story 5 · ${label} now sees`, 'OBSERVED',
        JSON.stringify((r?.members ?? []).map((m) => `${String(m.webid).slice(0, 8)}=${m.role}${m.adminVia ? '/' + m.adminVia : ''}`)));
    }

    // Was the new admin TOLD? A change of who runs a circle that nobody announces is the silent-change
    // failure this project keeps finding.
    // By ID as well as name — B is a JOINER and has no name for this circle (L55), so a name-only
    // match silently lands them in the help circle and every bubble read after it is about nothing.
    await openCircleMatching(B.page, new RegExp(`overdracht.?kring|${gid}`, 'i')).catch(() => {});
    await toChat(B.page);
    const bubbles = await readBubbles(B.page);
    log('story 5 · is the new admin told?', bubbles.some((t) => /beheer|admin|kring/i.test(t)) ? 'OBSERVED' : 'FINDING',
      JSON.stringify(bubbles.slice(0, 3)));

    // The sharper version from the story: the LAST admin leaves the circle entirely. The fold is
    // supposed to hand it to somebody, and that somebody is supposed to be told — the one authority
    // change nobody performs.
    const nowAdmin = (await call(B.page, 'stoop', 'listGroupMembers', { groupId: gid }))?.members ?? [];
    const lastAdmin = nowAdmin.find((m) => m.role === 'admin')?.webid ?? null;
    const asB = lastAdmin && lastAdmin !== me;
    if (asB) {
      // The confirm gate is RIGHT and worth keeping — but read what it says to a person:
      // "Re-run with --confirm=true to proceed." That is CLI vocabulary in a circle.
      const guarded = await call(B.page, 'stoop', 'leaveGroup', { groupId: gid });
      log('story 5 · what the confirm gate SAYS', 'OBSERVED', JSON.stringify(guarded)?.slice(0, 140));
      const left = await call(B.page, 'stoop', 'leaveGroup', { groupId: gid, confirm: true });
      log('story 5 · the last admin walks out', left?.error ? 'FINDING' : 'OBSERVED', JSON.stringify(left)?.slice(0, 140));
      await A.page.waitForTimeout(12000);
      for (const [peer, label] of [[A, 'A'], [C, 'C']]) {
        const r = await call(peer.page, 'stoop', 'listGroupMembers', { groupId: gid });
        log(`story 5 · who runs it now, per ${label}`, 'OBSERVED',
          JSON.stringify((r?.members ?? []).map((m) => `${String(m.webid).slice(0, 8)}=${m.role}${m.adminVia ? '/' + m.adminVia : ''}`)));
      }
      // WHICH device is the caretaker? The notice is addressed to the ONE person it happened to, so
      // reading the wrong screen would report "nobody was told" for a notice that was working.
      const fold = (await call(A.page, 'stoop', 'listGroupMembers', { groupId: gid }))?.members ?? [];
      const caretaker = fold.find((m) => String(m.adminVia ?? '').startsWith('caretaker:'))?.webid ?? null;
      const whoIs = async (peer) => (await call(peer.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
      const aId = await whoIs(A); const cId = await whoIs(C);
      const target = caretaker === aId ? A : (caretaker === cId ? C : null);
      log('story 5 · who became the caretaker', target ? 'OBSERVED' : 'BLOCKED',
        `caretaker=${String(caretaker).slice(0, 8)} A=${String(aId).slice(0, 8)} C=${String(cId).slice(0, 8)}`);
      if (target) {
        // Match on the ID as well as the name: a JOINER has no name for the circle (L55), so a
        // name-only match lands them in the help circle and every bubble read after it is meaningless.
        // The cost of L55 is not cosmetic — you cannot even REFER to the circle you are in.
        await openCircleMatching(target.page, new RegExp(`overdracht.?kring|${gid}`, 'i')).catch(() => {});
        await toChat(target.page);
        const bubbles2 = await readBubbles(target.page);
        // Does a ROSTER RE-READ bring the notice out? `caretakerNotice` hangs off `loadRoster`, and the
        // fold changed remotely (someone else left) — so "the notice does not fire" and "nothing
        // re-reads the roster when authority changes underneath you" look identical from the chat.
        const mtab = target.page.locator('.circle-view__tab[data-tab="members"]');
        if (await mtab.count()) { await mtab.first().click(); await target.page.waitForTimeout(4000); }
        const ctab = target.page.locator('.circle-view__tab[data-tab="conversation"]');
        if (await ctab.count()) { await ctab.first().click(); await target.page.waitForTimeout(2500); }
        await toChat(target.page);
        const afterReread = await readBubbles(target.page);
        log('story 5 · …and after a roster RE-READ?',
          afterReread.length > bubbles2.length ? 'OBSERVED — it appears on a re-read' : 'FINDING — still nothing',
          JSON.stringify(afterReread.slice(0, 2)));
        log('story 5 · is the CARETAKER told the circle became theirs?',
          bubbles2.some((t) => /beheer|kring|geen beheerder/i.test(t)) ? 'PASS' : 'FINDING',
          JSON.stringify(bubbles2.slice(0, 3)));
      }
    }
  } finally { await teardown(peers); }
});

test('story 3 — saying something, and knowing it arrived', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Bezorg Kring', re: /bezorg.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);
    await openCircleMatching(B.page, new RegExp(`bezorg.?kring|${gid}`, 'i'));
    await toChat(B.page);
    await toChat(A.page);

    const chipFor = (page, needle) => page.evaluate((n) => {
      const b = [...document.querySelectorAll('.circle-view__bubble')].find((e) => e.textContent.includes(n));
      return b ? (b.querySelector('.circle-view__bubble-delivery')?.dataset.deliveryState ?? null) : 'no-such-bubble';
    }, needle);

    await sendChat(A.page, 'BERICHT-EEN');
    await A.page.waitForTimeout(4000);
    log('story 3 · what the sender claims immediately', 'OBSERVED', String(await chipFor(A.page, 'BERICHT-EEN')));

    await B.page.waitForTimeout(6000);
    const got = await readBubbles(B.page);
    expect(got.some((t) => /BERICHT-EEN/.test(t)), 'the baseline must cross').toBe(true);

    // THE QUESTION: it arrived. Does the sender ever learn that? `stored` is the ladder's only positive
    // rung and it needs a RECEIPT from the recipient. The receiver half is built; nothing seems to send.
    await A.page.waitForTimeout(15000);
    const afterArrival = await chipFor(A.page, 'BERICHT-EEN');
    log('story 3 · …and after it demonstrably arrived', afterArrival === 'stored' ? 'PASS' : 'FINDING',
      `the chip says "${afterArrival}" — ${afterArrival === 'stored' ? 'the receipt came back' : 'no receipt; "delivered" is unreachable'}`);

    // Now the honest half: a peer that is dark. Does the sender say anything DIFFERENT?
    await B.context.setOffline(true);
    await B.page.waitForTimeout(2000);
    await sendChat(A.page, 'BERICHT-TWEE-IN-HET-DONKER');
    await A.page.waitForTimeout(8000);
    const dark = await chipFor(A.page, 'BERICHT-TWEE');
    log('story 3 · can the sender tell a dark peer from a live one?',
      dark !== afterArrival ? 'PASS' : 'FINDING',
      `live="${afterArrival}" dark="${dark}" — ${dark === afterArrival ? 'the same state for both, so the chip says nothing' : 'they differ'}`);

    await B.context.setOffline(false);
    await B.page.waitForTimeout(18000);
    await toChat(B.page);
    const flushed = await readBubbles(B.page);
    log('story 3 · does the held message arrive on return?',
      flushed.some((t) => /BERICHT-TWEE/.test(t)) ? 'PASS' : 'FINDING', `B has ${flushed.length} bubble(s)`);
  } finally { await teardown(peers); }
});

test('story 6 — someone has to go, and the island holds', async ({ browser }) => {
  const peers = await bootPeers(browser, 3);
  const [A, B, C] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Eiland Kring', re: /eiland.?kring/i });
    test.skip(!p.joined, 'pairing failed');
    await gotoCircles(C.page);
    await joinFromInvite(C.page, p.inviteUri, { handle: 'derde', tag: 'story6-C' });
    await C.page.waitForTimeout(6000);
    const gid = await activeCircle(A.page);
    const byId = new RegExp(`eiland.?kring|${gid}`, 'i');

    for (const peer of [B, C]) { await openCircleMatching(peer.page, byId).catch(() => {}); await toChat(peer.page); }
    await toChat(A.page);

    // Something to remember them by — the thing they must KEEP.
    await sendChat(A.page, 'VOOR-JE-VERTREK');
    await B.page.waitForTimeout(7000);
    const bBefore = await readBubbles(B.page);
    expect(bBefore.some((t) => /VOOR-JE-VERTREK/.test(t)), 'the baseline must cross').toBe(true);

    const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const bId = (await call(B.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const removal = await call(A.page, 'stoop', 'removeMember', { groupId: gid, memberWebid: bId, reason: 'walk' });
    log('story 6 · the removal', 'OBSERVED', JSON.stringify(removal)?.slice(0, 120));
    await B.page.waitForTimeout(12000);

    // 1 · they keep what they had
    await openCircleMatching(B.page, byId).catch(() => {});
    await toChat(B.page);
    const bAfter = await readBubbles(B.page);
    log('story 6 · do they keep what they already had?',
      bAfter.some((t) => /VOOR-JE-VERTREK/.test(t)) ? 'PASS' : 'FINDING',
      bAfter.some((t) => /VOOR-JE-VERTREK/.test(t)) ? 'their history is still theirs' : 'their history is GONE — the notice promises otherwise');

    // 2 · and they were told
    log('story 6 · were they told, sitting in the circle?', bAfter.some((t) => /geen lid meer/i.test(t)) ? 'PASS' : 'FINDING',
      JSON.stringify(bAfter.filter((t) => !bBefore.includes(t)).slice(0, 2)));

    // …and if not, does a ROSTER RE-READ bring it out? The notice hangs off `loadRoster`, and the fold
    // changed because of a statement that arrived from somewhere else — so "the notice does not fire"
    // and "nothing re-reads the roster when authority changes underneath you" look identical from a
    // chair. They are very different bugs: one is missing, the other is merely never reached.
    const mt = B.page.locator('.circle-view__tab[data-tab="members"]');
    if (await mt.count()) { await mt.first().click(); await B.page.waitForTimeout(5000); }
    const ct = B.page.locator('.circle-view__tab[data-tab="conversation"]');
    if (await ct.count()) { await ct.first().click(); await B.page.waitForTimeout(2500); }
    await toChat(B.page);
    const bReread = await readBubbles(B.page);
    log('story 6 · …and after a roster re-read?', bReread.some((t) => /geen lid meer/i.test(t)) ? 'OBSERVED — it appears' : 'FINDING — still nothing',
      JSON.stringify(bReread.filter((t) => !bBefore.includes(t)).slice(0, 2)));

    // 3 · the circle carries on WITHOUT a hitch for everyone else — the half nobody has checked
    await toChat(A.page);
    await sendChat(A.page, 'NA-HET-VERTREK');
    await C.page.waitForTimeout(9000);
    await openCircleMatching(C.page, byId).catch(() => {});
    await toChat(C.page);
    const cSees = await readBubbles(C.page);
    log('story 6 · does the circle carry on for the others?',
      cSees.some((t) => /NA-HET-VERTREK/.test(t)) ? 'PASS' : 'FINDING',
      `C has ${cSees.length} bubble(s)`);

    // 4 · and the removed person gets nothing new
    const bLater = await readBubbles(B.page);
    log('story 6 · does the removed person get anything NEW?',
      bLater.some((t) => /NA-HET-VERTREK/.test(t)) ? 'FINDING — forward secrecy broken' : 'PASS',
      bLater.some((t) => /NA-HET-VERTREK/.test(t)) ? 'they received a message sent after their removal' : 'nothing new reached them');
    expect(bLater.some((t) => /NA-HET-VERTREK/.test(t)), 'a removed member must not receive new messages').toBe(false);
  } finally { await teardown(peers); }
});
