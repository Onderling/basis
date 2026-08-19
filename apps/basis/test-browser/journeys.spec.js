/**
 * journeys.spec.js — the Phase-0 connectivity JOURNEY net.
 *
 * One Playwright test per user journey from plans/DESIGN-connectivity-phase0-harness.md
 * (the table) + the Phase-4 additions in plans/PLAN-peer-connectivity.md. Each journey
 * drives a REAL UX surface (composer · ⋯ menu · wizard · tabs) across N fresh browser
 * contexts — never a raw op — and asserts on BOTH peers' screens. This is the regression
 * net that stops the peer/transport layer from silently re-breaking.
 *
 * PHASE-0 INTENT — READ THIS:
 *   - This file LANDS THE NET. It does NOT try to make every journey pass. The transport
 *     + roster bugs (B1 empty MemberMap, B2 wrong invite address) are fixed in Phase 1+.
 *   - Every journey is tagged with the phase that makes it GREEN ("// GREEN IN: Phase N").
 *     Phase 1 flips pairing + entrust from red/fixme to green; Phase 2 flips fan-out,
 *     task-handoff, offline-catch-up, contact-share; Phase 3 flips leave-and-rotate;
 *     Phase 4 flips the rest.
 *   - Journeys whose UX surface exists today (pairing, fan-out, task-handoff, entrust)
 *     have REAL bodies mirroring the two-peer drive. They may still be RED in this sandbox
 *     until Phase 1 lands (roster empty / NKN flaky) — that's expected and is the point:
 *     "Phase 1 done" == pairing + entrust go green here.
 *   - Journeys whose surface does NOT exist yet (offline-catch-up, contact-share, bot-tag,
 *     leave-and-rotate, multi-device, governance-vote, equivocation, member-persona,
 *     self-view) are `test.fixme(...)` with the intended steps written out, so the net
 *     DOCUMENTS the target without failing CI.
 *
 * TRANSPORT REALITY: NKN by default (the dev server boots WITHOUT VITE_CIRCLE_RELAY_URL;
 * NKN is the app's own relay/rendezvous). NKN is unreliable in a sandbox. Supply a local
 * relay with `VITE_CIRCLE_RELAY_URL=ws://127.0.0.1:PORT` for a hermetic run — the app's
 * router then picks NKN→relay automatically.
 *
 * COMMIT DECISION (for Frits): unlike twopeer.spec.js (a throwaway scratch drive), this
 * file is INTENDED as the persistent Phase-0 regression net. Whether it lands in the
 * committed suite now — or waits until Phase 1 flips its first journeys green so CI isn't
 * red-by-design — is your call. Flagged here rather than decided.
 *
 * Run:  cd apps/basis && npx playwright test test-browser/journeys.spec.js
 *   relay variant:  VITE_CIRCLE_RELAY_URL=ws://127.0.0.1:8787 npx playwright test test-browser/journeys.spec.js
 */
import { test, expect } from '@playwright/test';
import * as H from './peerHarness.js';

test.setTimeout(420_000);

// ─────────────────────────────────────────────────────────────────────────────
// pairing — two peers become co-members.
// Surface: create-circle wizard → ⋯ invite → launcher join wizard → redeem.
// Assert: both rosters show 2 (admin panel). GREEN IN: Phase 1 (fixes B1 empty roster + B2 addr).
// ─────────────────────────────────────────────────────────────────────────────
test('pairing — two peers pair over the app transport into one circle', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const res = await H.pair(A, B, { name: 'Peer Circle' });
    console.log('pairing:', JSON.stringify(res));
    expect(res.inviteUri, 'peer A produced a onderling-invite URI').toBeTruthy();

    // The redeem handshake completing (wizard closed) is the Phase-0-provable part.
    expect(res.joined || res.joinerHasTile, 'B joined the circle (wizard closed / tile present)').toBeTruthy();

    // Read both rosters. Phase-1 acceptance: BOTH show 2. Until Phase 1 this is the
    // journey that stays red (B1) — the assertion below is the acceptance gate.
    await H.reopenCircle(B.page, /peer.?circle/i);
    const bRoster = await H.readRoster(B.page);
    await A.page.waitForTimeout(2500);
    const aRoster = await H.readRoster(A.page);
    console.log('pairing rosters — A:', JSON.stringify(aRoster), 'B:', JSON.stringify(bRoster));
    await H.shot(A.page, 'pairing-A-members');
    await H.shot(B.page, 'pairing-B-members');

    // GREEN IN Phase 1: flip these from the OR-soft check to hard `toBeGreaterThanOrEqual(2)` on both.
    expect(aRoster.count, 'A roster shows both members (Phase 1)').toBeGreaterThanOrEqual(2);
    expect(bRoster.count, 'B roster shows both members (Phase 1)').toBeGreaterThanOrEqual(2);
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// fan-out — A's chat message reaches B.
// Surface: chat composer → B's chat stream.
// Assert: B's stream shows A's message. GREEN IN: Phase 2 (send/route/deliver ladder; also needs Phase-1 roster).
// ─────────────────────────────────────────────────────────────────────────────
test('fan-out — a message from A appears in B chat', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const res = await H.pair(A, B, { name: 'Peer Circle' });
    console.log('fan-out pairing:', JSON.stringify(res));
    test.skip(!res.joinerHasTile, 'B never joined the circle (pairing precondition) — see pairing journey');

    await H.reopenCircle(A.page, /peer.?circle/i);
    await H.reopenCircle(B.page, /peer.?circle/i);

    const msg = `hoi vanaf A ${Date.now().toString(36)}`;
    await H.toChat(A.page);
    await H.sendChat(A.page, msg, 3000);
    const got = await H.waitForBubble(B.page, msg);
    console.log('fan-out B tail:', JSON.stringify((await H.readBubbles(B.page)).slice(-4)));
    await H.shot(A.page, 'fanout-A');
    await H.shot(B.page, 'fanout-B');

    expect(got, `B received A's message ${JSON.stringify(msg)} (Phase 2)`).toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// task-handoff — A adds a task, B sees it and claims it, A sees it claimed.
// Surface: /addtask in chat → B's Taken tab → B claim chip → A's Taken tab.
// Assert: B's Taken tab shows the task; after B claims, A sees the claimed state.
// GREEN IN: Phase 2 (needs fan-out delivery of the task event; roster from Phase 1).
// ─────────────────────────────────────────────────────────────────────────────
test('task-handoff — A adds a task, B claims it', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const res = await H.pair(A, B, { name: 'Peer Circle' });
    test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');

    // Tasks is CIRCLE policy (default OFF). The ADMIN turns it on; the change fans out to members as a
    // PENDING policy, and a member ADOPTS it by opening settings — where the app shows the incoming
    // document and asks them to apply it. So both peers act, but they act differently: A decides, B
    // consents. `enableFeature` handles the member half (see its conflict-resolution step).
    await H.reopenCircle(A.page, /peer.?circle/i);
    await H.enableFeature(A.page, 'tasks');
    await H.reopenCircle(A.page, /peer.?circle/i);
    await H.reopenCircle(B.page, /peer.?circle/i);
    await H.enableFeature(B.page, 'tasks');
    await H.reopenCircle(B.page, /peer.?circle/i);

    await H.addTask(A.page, 'verf kopen');
    console.log('task-handoff A bubbles:', JSON.stringify((await H.readBubbles(A.page)).slice(-3)));

    // B sees the task in its Taken tab.
    await B.page.waitForTimeout(3500);
    const bTaken = await H.openTakenTab(B.page);
    console.log('task-handoff B Taken:', JSON.stringify(bTaken));
    await H.shot(B.page, 'task-B-taken');
    expect(bTaken.present, 'B has a Taken tab (tasks feature on)').toBeTruthy();
    expect(bTaken.rows.some((r) => /verf/i.test(r)), "B's Taken tab shows A's task (Phase 2)").toBeTruthy();

    // B claims it → A sees it claimed.
    const claim = await H.claimTask(B.page, /verf/i);
    console.log('task-handoff B claim:', JSON.stringify(claim));
    await A.page.waitForTimeout(3500);
    const aTaken = await H.openTakenTab(A.page);
    console.log('task-handoff A Taken after claim:', JSON.stringify(aTaken));
    await H.shot(A.page, 'task-A-claimed');
    expect(claim.claimed, 'B could claim the task').toBeTruthy();
    // GREEN IN Phase 2: A's row reflects the claimed status once the claim event fans out.
    expect(aTaken.rows.some((r) => /verf/i.test(r)), "A still shows the task row (claimed state fans back)").toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// entrust — A entrusts a task to B; the mandate picker's WIE (who) list includes B.
// Surface: Taken tab → "Toevertrouwen" chip → mandate picker WIE → confirm.
// Assert: WIE lists B (not "niemand anders"); the grant is recorded.
// GREEN IN: Phase 1 (WIE = roster; empty roster is exactly why WIE is empty today).
// ─────────────────────────────────────────────────────────────────────────────
test('entrust — the mandate picker lists peer B and A entrusts the task', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const res = await H.pair(A, B, { name: 'Peer Circle' });
    test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');

    await H.reopenCircle(A.page, /peer.?circle/i);
    await H.enableFeature(A.page, 'tasks');
    await H.reopenCircle(A.page, /peer.?circle/i);
    await H.addTask(A.page, 'verf kopen');

    const picker = await H.openMandatePicker(A.page);
    console.log('entrust picker:', JSON.stringify({ ...picker, text: picker.text.slice(0, 160) }));
    await H.shot(A.page, 'entrust-picker');
    expect(picker.opened, 'the mandate picker opened').toBeTruthy();

    // GREEN IN Phase 1: WIE lists B (roster reflects the joiner). Today (B1) it is empty.
    expect(picker.whoCount >= 1 && picker.emptyNote === 0,
      'WIE lists peer B — no "niemand anders" (Phase 1)').toBeTruthy();

    const done = await H.entrustFirstMember(A.page);
    console.log('entrust result:', JSON.stringify({ entrusted: done.entrusted, whoCount: done.whoCount }));
    await H.shot(A.page, 'entrust-result');
    expect(done.entrusted, 'A completed the entrust flow').toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// offline-catch-up — B is away while A posts; B reopens and catches up (log-diff).
// Surface: B closes its context → A sends → B reopens → catch-up on reconnect.
// Assert: B, after reopening, shows the message it missed. GREEN IN: Phase 2 (sender-hold + presence-flush + catch-up).
// FIXME: catch-up on reconnect isn't driven on the web NKN path yet (G10), and re-opening a
// fresh context = a NEW identity, so "same B returns" needs persisted storage_state (Phase 2 harness work).
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('offline-catch-up — B catches up a message sent while it was away', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const res = await H.pair(A, B, { name: 'Peer Circle' });
    test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');

    // Take B offline (close its context; Phase 2 will re-attach the SAME identity via storage_state).
    await B.context.close();
    await H.reopenCircle(A.page, /peer.?circle/i);
    const msg = `terwijl-B-weg ${Date.now().toString(36)}`;
    await H.sendChat(A.page, msg, 3000);

    // B returns (Phase 2: restore B's storage so it's the same peer, then reconnect → catch-up).
    // const B2 = await H.bootPeer(browser, 'B', { /* storageState: bState */ });
    // await H.reopenCircle(B2.page, /peer.?circle/i);
    // expect(await H.waitForBubble(B2.page, msg)).toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// contact-share — share a task/video to a CONTACT (no circle involved).
// Surface: Contacten → pick a contact → share an object (DM/addressed send).
// Assert: the object arrives at the contact. GREEN IN: Phase 2 (one addressed send folds the DM paths — C3).
// FIXME: the contact-share affordance + durable DM thread aren't built (C3/G18); no stable surface to drive.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('contact-share — an object shared to a contact arrives without a circle', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    // Intended: A adds B as a contact (contact-add handshake), opens Contacten, shares a task/video.
    // await H.gotoContacts(A.page); await H.addContact(A.page, bInviteOrHandle);
    // await H.shareToContact(A.page, /B/, { kind: 'task', text: 'verf kopen' });
    // await H.gotoContacts(B.page); expect(await H.contactInbox(B.page)).toContain('verf');
    expect(true).toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// bot-tag — in a circle with the bot, an untagged line is silent; @tagging it answers.
// Surface: chat composer (plain line vs @assistant/@onderling line).
// Assert: bot silent when untagged, replies when @tagged. GREEN IN: Phase 2/4 (bot engagement policy).
// FIXME: needs a circle LLM provider wired (config injects a dummy loopback) + the @-tag engage gate;
// deterministic-gate path exists but the untagged-silence assertion isn't a stable multi-peer surface yet.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('bot-tag — the bot stays silent untagged and answers when @tagged', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 1);
  const [A] = peers;
  try {
    // Intended: open the help/Onderling circle (has the bot), send a plain line → assert no bot bubble;
    // send "@onderling is dit veilig?" → assert a bot bubble with a provenance badge appears.
    // await H.reopenCircle(A.page, /onderling|cc-help/i);
    // const before = (await H.readBubbles(A.page)).length;
    // await H.sendChat(A.page, 'zomaar een zin'); expect((await H.readBubbles(A.page)).length).toBe(before + 1);
    // await H.sendChat(A.page, '@onderling is dit veilig?', 4500);
    // expect((await H.readBubbles(A.page)).some((b) => /veilig|beveilig/i.test(b))).toBeTruthy();
    expect(true).toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// leave-and-rotate — admin removes B; A posts; a late joiner C reads history.
// Surface: admin panel remove → A chat post → C joins → key rotation resolves old/new.
// Assert: B can't read post-removal messages; C (late) still reads pre-removal history.
// GREEN IN: Phase 3 (seal resolver + no-pod key rotation into the log — C11/G11).
// FIXME: no-pod key rotation + the seal-by-policy resolver aren't built; "B can't read after removal"
// has no drivable assertion until sealing lands.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('leave-and-rotate — removed member loses access, late joiner keeps history', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 3);
  const [A, B, C] = peers;
  try {
    // Intended: A pairs B; A posts msg1; A removes B via admin panel; A posts msg2;
    // C joins; assert C sees msg1 (history) but B never sees msg2 (rotated key).
    // await H.pair(A, B); await H.sendChat(A.page, 'msg1');
    // await H.removeMember(A.page, /B/); await H.sendChat(A.page, 'msg2');
    // await H.pair(A, C); expect(await H.waitForBubble(C.page, 'msg1')).toBeTruthy();
    // expect(await H.waitForBubble(B.page, 'msg2', {tries:4})).toBeFalsy();
    expect(true).toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// multi-device — one identity on two contexts; both receive; edits converge.
// Surface: two contexts sharing the SAME identity (storage_state), same circle.
// Assert: a message/edit on device 1 shows on device 2. GREEN IN: Phase 4 (multi-device live sync — G14).
// FIXME: multi-device = re-derive identity with NO live sync today (G14); needs shared storage_state
// + the per-device coordination Phase 4 builds.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('multi-device — the same identity on two devices stays in sync', async ({ browser }) => {
  // Intended: boot device1, create a circle; export its storage_state; boot device2 FROM that state
  // (same identity), open the same circle; post on device1 → assert it lands on device2; edit → converges.
  expect(true).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// governance-vote — a rule change under a decision-class policy is tallied.
// Surface: settings/rule-change under any-admin | admin-quorum | all-vote(+deadline).
// Assert: each policy tallies correctly (single admin acts / quorum needed / all vote + deadline).
// GREEN IN: Phase 4 (governance decision-class policy).
// FIXME: the decision-class policy + vote-tally UX aren't built yet.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('governance-vote — a decision-class rule change tallies per policy', async ({ browser }) => {
  // Intended: set a circle's decision policy; propose a rule change; have the required members vote;
  // assert the change applies only when the tally rule (any-admin / quorum / all+deadline) is met.
  expect(true).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// equivocation — inject a fork (test hook); the author is flagged; review&remove UX.
// Surface: a fork-proof event → author flagged "disputed" → review & remove.
// Assert: the fork is detected and surfaced; the disputed author is reviewable/removable.
// GREEN IN: Phase 4 (hash-chain per-author + fork-proof + review UX).
// FIXME: per-author hash-chain + fork-proof detection aren't built; needs the Phase-4 test hook.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('equivocation — a forked author is flagged disputed and reviewable', async ({ browser }) => {
  // Intended: via a Phase-4 test hook, inject two conflicting log heads from one author;
  // assert the fork-proof event fires, the author shows "disputed", and the review→remove action exists.
  expect(true).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// member-persona — tap a member; their persona card shows only what they revealed to me.
// Surface: MEMBERS (members) tab → tap a member → persona/reveal card.
// Assert: the card shows exactly the properties that member revealed to the viewer.
// GREEN IN: Phase 4 (the real MEMBERS tab with tappable rows → persona card — G16).
// FIXME: G16 — the MEMBERS tab is a placeholder; the persona card off a member row isn't built.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('member-persona — a member row opens their reveal-scoped persona card', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const res = await H.pair(A, B, { name: 'Peer Circle' });
    test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');
    await H.reopenCircle(A.page, /peer.?circle/i);
    const members = await H.openLedenTab(A.page);
    console.log('member-persona MEMBERS tab present:', members.present, 'tabs:', JSON.stringify(members.labels));
    // Intended (Phase 4): tap B's row → assert the persona card lists only B's revealed-to-A properties.
    // await H.tapMemberRow(A.page, /B|peerbee/); expect(await H.personaCardFields(A.page)).toEqual(bRevealedToA);
    expect(members.present, 'the real MEMBERS tab exists (G16 — Phase 4)').toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// self-view — tap yourself → "View as…"; the sees/hides split matches reveal rules.
// Surface: MEMBERS tab → tap self → "View as <viewer>" → the visible/hidden split.
// Assert: for a chosen viewer, the shown vs hidden properties match my reveal policy.
// GREEN IN: Phase 4 (reuse the viewAs / circleViewAs / viewAsAttributes machinery).
// FIXME: depends on the same unbuilt MEMBERS tab (G16) + a "View as" affordance on the self row.
// ─────────────────────────────────────────────────────────────────────────────
test.fixme('self-view — "View as" shows the reveal split for a chosen viewer', async ({ browser }) => {
  const peers = await H.bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    const res = await H.pair(A, B, { name: 'Peer Circle' });
    test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');
    await H.reopenCircle(A.page, /peer.?circle/i);
    const members = await H.openLedenTab(A.page);
    // Intended (Phase 4): tap A's own row → "View as B" → assert visible == A-revealed-to-B, hidden == rest.
    // await H.tapMemberRow(A.page, /jij|A/); await H.viewAs(A.page, /B|peerbee/);
    // expect(await H.visibleFields(A.page)).toEqual(aRevealedToB);
    expect(members.present, 'the real MEMBERS tab exists (G16 — Phase 4)').toBeTruthy();
  } finally {
    await H.teardown(peers);
  }
});
