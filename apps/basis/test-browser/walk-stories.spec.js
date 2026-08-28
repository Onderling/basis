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
  gotoCircles, createCircle, openCircleMatching } from './peerHarness.js';

test.setTimeout(420_000);

const surface  = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call     = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;
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
