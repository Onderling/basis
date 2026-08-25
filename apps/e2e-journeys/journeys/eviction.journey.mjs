// J-eviction: the doors. Who may put someone out, what happens when they do, and what the person
// who was put out — or never let in — can still reach.
//
// Frits named this one directly: "important safety events should be evaluated (like removing members
// from a circle)". It is the sharpest test in the programme because eviction is the only act where
// the adversary is a real device that HELD the keys a moment ago. A UI that stops offering them the
// circle proves nothing; the question is whether the remaining members' rails refuse what that
// device signs. That is the enforceability test with teeth.
//
//   Anne  — admin
//   Bram  — member, and the one who gets removed
//   Cato  — member, the bystander who must end up with the same roster as the admin
//   Zus   — on the same relay, never a member: the stranger at every door
//
// Four claims:
//   1. AUTHORITY — an ordinary member cannot remove anyone. Removal is admin-only at the substrate.
//   2. EFFECT    — when the admin removes someone, every device's roster agrees, including the
//                  removed person's own.
//   3. AFTERMATH — the removed device cannot talk its way back in. Not "the button is gone" — the
//                  statement it signs must be refused where it lands.
//   4. STRANGER  — someone who was never a member is refused at every door they can knock on.
import { checker } from './_util.mjs';
import { bootAppCircle, rosterOf, hasMember, untilTrue, sendCircleChat } from './_app.mjs';

export const name = 'J-eviction (who may remove, what removal does, and what the removed can still reach)';

const CIRCLE = 'e2e-eviction';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({
      relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'], outsiders: ['zus'],
    });
    const [anne, bram, cato] = circle.people;
    const [zus] = circle.outsiders;
    const call = (node, op, args) => node.agent.callSkill('stoop', op, args);

    check('the circle starts with all three', hasMember(await rosterOf(anne, CIRCLE), bram.pubKey));

    // ── 1. AUTHORITY — removal is not something an ordinary member can do ─────────────────────────
    // [F-009] `removeMember`'s gate is `isCircleAdmin(members.resolveByWebid(from)?.role)`, and the
    // MemberMap is a FLAT webid→row map with one role per person, no circle in the key. Every agent
    // is admin of their OWN household, so the gate asks "is this person an admin anywhere?" and the
    // answer is always yes. Same ref-space mismatch as the vote tally: a per-circle question asked of
    // a circle-less table.
    const memberTries = await call(bram, 'removeMember', { groupId: CIRCLE, memberWebid: cato.pubKey });
    check('[F-009] an ORDINARY MEMBER cannot remove someone', !!memberTries?.error,
      JSON.stringify(memberTries)?.slice(0, 150));

    const strangerTries = await call(zus, 'removeMember', { groupId: CIRCLE, memberWebid: bram.pubKey });
    check('[F-009] a STRANGER cannot remove someone either', !!strangerTries?.error,
      JSON.stringify(strangerTries)?.slice(0, 150));

    // …and the half that decides whether F-009 is a breach or a contract defect: the SPINE re-derives
    // who may evict on every device, so an unauthorised evict is refused where it lands. This is the
    // boundary that actually holds people out; it is asserted separately so a future change to the
    // op's gate can never quietly take it with it.
    check('the unauthorised removals do NOT leave the device — the circle\'s roster is intact',
      hasMember(await rosterOf(anne, CIRCLE), cato.pubKey)
      && hasMember(await rosterOf(cato, CIRCLE), bram.pubKey));

    // ── 2. EFFECT — the admin removes, and every device agrees ────────────────────────────────────
    const removed = await call(anne, 'removeMember', {
      groupId: CIRCLE, memberWebid: bram.pubKey, reason: 'test',
    });
    check('THE ADMIN can remove a member', !removed?.error, JSON.stringify(removed)?.slice(0, 200));

    check('the admin\'s own roster drops them',
      await untilTrue(async () => !hasMember(await rosterOf(anne, CIRCLE), bram.pubKey)));
    check('THE BYSTANDER learns of it too — one circle, one roster',
      await untilTrue(async () => !hasMember(await rosterOf(cato, CIRCLE), bram.pubKey)));
    check('the bystander is untouched by someone else\'s removal',
      hasMember(await rosterOf(anne, CIRCLE), cato.pubKey));
    // The removal reaches the person it is about. The evict statement is fanned to the subject as
    // well as to the circle — by then they are off the roster, so the member fan alone reached
    // everyone except the one who most needed it (was F-011).
    check('the REMOVED person\'s own device learns it as well',
      await untilTrue(async () => !hasMember(await rosterOf(bram, CIRCLE), bram.pubKey)));

    // ── 3. AFTERMATH — the removed device still holds its old keys. Can it talk its way back? ─────
    // Everything below is asked of the REMAINING members' state, never of the removed device's UI.
    const beforeCount = cato.chatRail.storedStatements(CIRCLE).length;
    await sendCircleChat(bram, { groupId: CIRCLE, msgId: 'ghost-1', text: 'ik ben er nog' }).catch(() => {});
    const ghostLanded = await untilTrue(async () => cato.chatRail.storedStatements(CIRCLE)
      .some((s) => s?.body?.subject === 'ghost-1'), 4000);
    // [F-019] This was green until 2026-08-23, and green for the WRONG REASON: the removed member's
    // fan was resolving nobody, so nothing arrived and no gate was ever consulted. Once the roster
    // that fan reads was corrected (M1a), the message started arriving — and the receiver's binding
    // verifier does not refuse it, because it reads the roster SPINELESS and an eviction is a spine
    // statement. A removed member can post into the circle.
    check('[F-019] a REMOVED member cannot post into the circle',
      !ghostLanded, `${cato.chatRail.storedStatements(CIRCLE).length - beforeCount} new statement(s) at the bystander`);

    const ghostPost = await call(bram, 'postRequest', { text: 'nog een poging', intent: 'ask' });
    const ghostSeen = await untilTrue(async () => {
      const board = await call(cato, 'listRequests', { groupId: CIRCLE }).catch(() => null);
      const rows = board?.items ?? board?.requests ?? [];
      return rows.some((r) => (r.text ?? '') === 'nog een poging');
    }, 4000);
    check('a removed member\'s noticeboard post does not reach the circle', !ghostSeen,
      JSON.stringify(ghostPost)?.slice(0, 120));

    const ghostRoster = await call(bram, 'listGroupRoster', { groupId: CIRCLE });
    // …and knowing changes what their device will answer: a circle you are no longer in answers you
    // like one you never joined. The history stays on their disk — it cannot be taken away — but the
    // live roster is no longer a question they are owed an answer to.
    check('a removed member can no longer read the circle\'s roster',
      !!ghostRoster?.error || (ghostRoster?.roster ?? ghostRoster?.members ?? []).length === 0,
      JSON.stringify(ghostRoster)?.slice(0, 150));

    const ghostRules = await call(bram, 'editGroupRules', {
      groupId: CIRCLE, rules: { agreements: 'ik maak de regels' },
    });
    check('[F-010] a removed member cannot rewrite the circle\'s rules', !!ghostRules?.error,
      JSON.stringify(ghostRules)?.slice(0, 150));
    const ghostRulesReached = await untilTrue(async () => {
      const r = await call(cato, 'getGroupRules', { groupId: CIRCLE }).catch(() => null);
      return JSON.stringify(r ?? {}).includes('ik maak de regels');
    }, 5000);
    check('a removed member\'s rules edit does NOT reach the circle', !ghostRulesReached);

    // ── 4. STRANGER — every door, from someone who was never inside ───────────────────────────────
    const zusRoster = await call(zus, 'listGroupRoster', { groupId: CIRCLE });
    check('a stranger cannot read the roster',
      !!zusRoster?.error || (zusRoster?.roster ?? zusRoster?.members ?? []).length === 0,
      JSON.stringify(zusRoster)?.slice(0, 150));

    // [F-010] `editGroupRules` accepts a write from someone who is not in the circle at all.
    const zusRules = await call(zus, 'editGroupRules', { groupId: CIRCLE, rules: { agreements: 'hoi, van een vreemde' } });
    check('[F-010] a stranger cannot set the rules', !!zusRules?.error, JSON.stringify(zusRules)?.slice(0, 150));

    // Again the boundary that matters: does the outsider's version of the rules reach the members?
    const rulesReached = await untilTrue(async () => {
      const r = await call(cato, 'getGroupRules', { groupId: CIRCLE }).catch(() => null);
      return JSON.stringify(r ?? {}).includes('van een vreemde');
    }, 5000);
    check('an outsider\'s rules edit does NOT reach the circle', !rulesReached);

    const zusJoin = await call(zus, 'recordRemoteRedemption', {
      groupId: CIRCLE, redeemedBy: zus.pubKey, handle: 'zus',
    });
    const zusIn = await untilTrue(async () => hasMember(await rosterOf(anne, CIRCLE), zus.pubKey), 4000);
    check('a stranger cannot write themselves onto the circle\'s roster', !zusIn,
      JSON.stringify(zusJoin)?.slice(0, 150));

    await sendCircleChat(zus, { groupId: CIRCLE, msgId: 'stranger-1', text: 'mag ik erbij' }).catch(() => {});
    const zusChat = await untilTrue(async () => cato.chatRail.storedStatements(CIRCLE)
      .some((s) => s?.body?.subject === 'stranger-1'), 4000);
    check('a stranger cannot post into the circle\'s chat', !zusChat);

    // ── 5. The circle keeps working for the people still in it ───────────────────────────────────
    await sendCircleChat(anne, { groupId: CIRCLE, msgId: 'after-1', text: 'we gaan verder' });
    check('the circle still works for the remaining members',
      await untilTrue(async () => cato.chatRail.storedStatements(CIRCLE)
        .some((s) => s?.body?.subject === 'after-1')));
  } catch (err) {
    check('the eviction corridor completed', false, String(err?.message ?? err).slice(0, 200));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
