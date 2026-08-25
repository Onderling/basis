// J-promotion: handing over authority — and the fact that the op is not what enforces it.
//
// "Role change / promotion" was one of the zero-coverage domains, for the plainest possible reason:
// `setMemberRole` did not exist. The membership lane DECLARED a `role` statement kind and the
// roster fold in core implemented it in full — causal-depth authority, deny-wins, founders as root
// — and nothing ever wrote one. A declared lane kind with no producer.
//
// Now there is a producer, so the corridor can be walked. What it has to show is not "the button
// works" but the two things that make handing over authority safe:
//
//   1. IT TRAVELS AND CONVERGES. A promotion is a signed statement, so every device folds the same
//      answer to "who runs this circle" — the question J-lastadmin caught three devices giving
//      three answers to.
//   2. THE FOLD IS THE GATE, NOT THE OP. A member who skips the op and emits the statement directly
//      is refused by everyone else's fold. This is the enforceability test applied to authority
//      itself: could a different client promote itself? It is the whole point of putting roles on
//      the spine, and it is asserted here against a hand-emitted statement rather than against a
//      button nobody pressed.
//
//   3. AUTHORITY CANNOT BE SWITCHED OFF, BUT IT CAN BE PUT DOWN. The last admin stepping back does
//      not get refused — the circle hands over to whoever the fold appoints, the same answer a
//      departure already got. One rule: a circle with members always has an admin.
//
//   Anne — admin, hands over
//   Bram — member, becomes admin, acts as one, then steps down himself
//   Cato — member throughout, and the third device the answer must match on
import { checker } from './_util.mjs';
import { bootAppCircle, rosterOf, hasMember, roleOf, untilTrue } from './_app.mjs';

export const name = 'J-promotion (authority handed over — and the fold, not the op, is the gate)';

const CIRCLE = 'e2e-promotion';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    const call = (node, op, args) => node.agent.callSkill('stoop', op, args);

    check('the circle starts with one admin',
      (await roleOf(anne, CIRCLE, anne.pubKey)) === 'admin'
      && (await roleOf(anne, CIRCLE, bram.pubKey)) === 'member');

    // ── 1. A MEMBER CANNOT PROMOTE — at the op ───────────────────────────────────────────────────
    const selfPromote = await call(bram, 'setMemberRole', {
      groupId: CIRCLE, memberWebid: bram.pubKey, role: 'admin',
    });
    check('a member cannot promote themselves', !!selfPromote?.error,
      JSON.stringify(selfPromote)?.slice(0, 120));

    const promoteOther = await call(cato, 'setMemberRole', {
      groupId: CIRCLE, memberWebid: bram.pubKey, role: 'admin',
    });
    check('…nor promote somebody else', !!promoteOther?.error,
      JSON.stringify(promoteOther)?.slice(0, 120));

    // ── 2. THE FOLD IS THE GATE — the same act, with the op skipped ──────────────────────────────
    // The op's refusal above is worth nothing if a client can simply not call it. So emit the
    // statement directly, exactly as the op would have: signed with bram's real per-circle key,
    // chained, fanned. What must stop it is every OTHER device's fold, and nothing else.
    const forged = await bram.agent.membershipRail?.append(CIRCLE, {
      kind: 'role', subject: bram.pubKey, payload: { role: 'admin' },
    });
    check('a member CAN sign and append the statement — nothing stops them locally',
      !!forged?.statement, JSON.stringify(forged)?.slice(0, 100));
    if (forged?.statement) {
      await call(bram, 'broadcastCircleMembership', {
        groupId: CIRCLE, event: forged.statement, msgId: `role:${forged.statement.body.hash}`, ts: Date.now(),
      }).catch(() => {});
    }
    const tookAtAdmin = await untilTrue(async () => (await roleOf(anne, CIRCLE, bram.pubKey)) === 'admin', 6000);
    check('SELF-PROMOTION IS REFUSED WHERE IT LANDS — the admin\'s device does not adopt it',
      !tookAtAdmin, `admin sees: ${await roleOf(anne, CIRCLE, bram.pubKey)}`);
    check('…and so does the bystander\'s', (await roleOf(cato, CIRCLE, bram.pubKey)) !== 'admin',
      `bystander sees: ${await roleOf(cato, CIRCLE, bram.pubKey)}`);

    // ── 3. THE ADMIN HANDS OVER, AND IT CONVERGES ───────────────────────────────────────────────
    const promoted = await call(anne, 'setMemberRole', {
      groupId: CIRCLE, memberWebid: bram.pubKey, role: 'admin',
    });
    check('THE ADMIN CAN PROMOTE A MEMBER', promoted?.ok === true,
      JSON.stringify(promoted)?.slice(0, 140));

    check('the promotion reaches the promoted person\'s own device',
      await untilTrue(async () => (await roleOf(bram, CIRCLE, bram.pubKey)) === 'admin'),
      `they see: ${await roleOf(bram, CIRCLE, bram.pubKey)}`);
    check('…and the bystander\'s — one circle, one answer to who runs it',
      await untilTrue(async () => (await roleOf(cato, CIRCLE, bram.pubKey)) === 'admin'),
      `bystander sees: ${await roleOf(cato, CIRCLE, bram.pubKey)}`);
    check('the person who is still a member is unchanged by it',
      (await roleOf(anne, CIRCLE, cato.pubKey)) === 'member');

    // ── 4. THE NEW ADMIN'S AUTHORITY IS REAL ────────────────────────────────────────────────────
    // A role that does not let you act is a label. The sharpest act a circle has is removal.
    const nowCanRemove = await call(bram, 'removeMember', {
      groupId: CIRCLE, memberWebid: cato.pubKey, reason: 'test',
    });
    check('THE NEW ADMIN CAN ACT — the promotion is authority, not a label',
      !nowCanRemove?.error, JSON.stringify(nowCanRemove)?.slice(0, 140));
    check('and the removal converges on the original admin\'s device',
      await untilTrue(async () => !hasMember(await rosterOf(anne, CIRCLE), cato.pubKey)));

    // ── 5. AUTHORITY CAN BE HANDED BACK, BUT NOT SWITCHED OFF ───────────────────────────────────
    const demoted = await call(anne, 'setMemberRole', {
      groupId: CIRCLE, memberWebid: bram.pubKey, role: 'member',
    });
    check('an admin can be demoted again', demoted?.ok === true, JSON.stringify(demoted)?.slice(0, 120));
    check('the demotion converges too',
      await untilTrue(async () => (await roleOf(anne, CIRCLE, bram.pubKey)) === 'member'),
      `admin sees: ${await roleOf(anne, CIRCLE, bram.pubKey)}`);

    // ── 6. THE ORGANISER MOVES AWAY — a founder hands the circle over ───────────────────────────
    // Frits' call (2026-08-23): a founder is demotable once another admin exists. Permanence was
    // never the point; continuity is. So promote someone first, then step back.
    const handover = await call(anne, 'setMemberRole', {
      groupId: CIRCLE, memberWebid: bram.pubKey, role: 'admin',
    });
    check('the founder promotes a successor', handover?.ok === true, JSON.stringify(handover)?.slice(0, 110));
    await untilTrue(async () => (await roleOf(anne, CIRCLE, bram.pubKey)) === 'admin');

    const stepBack = await call(anne, 'setMemberRole', {
      groupId: CIRCLE, memberWebid: anne.pubKey, role: 'member',
    });
    check('THE FOUNDER CAN STEP BACK once someone else can run it', stepBack?.ok === true,
      JSON.stringify(stepBack)?.slice(0, 110));
    check('…and every device agrees they are no longer an admin',
      await untilTrue(async () => (await roleOf(bram, CIRCLE, anne.pubKey)) === 'member', 12000),
      `successor sees the founder as: ${await roleOf(bram, CIRCLE, anne.pubKey)}`);
    check('…but they are still IN the circle they made — stepping back is not being put out',
      hasMember(await rosterOf(bram, CIRCLE), anne.pubKey));

    // The successor now genuinely runs it.
    const successorActs = await call(bram, 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'Onder nieuw beheer', agreements: 'we gaan door' },
    });
    check('the successor can now run the circle', !successorActs?.error,
      JSON.stringify(successorActs)?.slice(0, 110));

    // ── 7. …AND THE LAST ONE STEPS DOWN BY HANDING OVER, NOT BY BEING REFUSED ───────────────────
    // This used to assert that the demotion was REFUSED. It was — and that was the worse of two
    // answers the system gave to one question: walking OUT of a circle as its last admin appointed a
    // successor, while stepping BACK from running it did nothing at all, silently, at exactly the
    // moment the person stops watching whether it worked. Both hand over now.
    const lastOne = await call(bram, 'setMemberRole', {
      groupId: CIRCLE, memberWebid: bram.pubKey, role: 'member',
    });
    check('the last admin can step down at all (or is told why not)', true,
      JSON.stringify(lastOne)?.slice(0, 110));

    check('THE STEP-DOWN ACTUALLY HAPPENS — it is not silently swallowed',
      await untilTrue(async () => (await roleOf(bram, CIRCLE, bram.pubKey)) === 'member', 12000),
      `bram's own device says he is: ${await roleOf(bram, CIRCLE, bram.pubKey)}`);

    // A circle with members always has an admin: the fold appoints one from whoever is left, and
    // never the person who just stepped down.
    const rosterNow = await rosterOf(bram, CIRCLE);
    const adminsNow = rosterNow.filter((m) => m.role === 'admin');
    check('…and the circle still has exactly one admin — someone else',
      adminsNow.length === 1 && (adminsNow[0].webid ?? adminsNow[0].addr) !== bram.pubKey,
      JSON.stringify(rosterNow.map((m) => [m.handle ?? (m.webid ?? m.addr)?.slice(0, 6), m.role])));

    // …and the OTHER REMAINING MEMBER agrees WHO, or the circle has two opinions about its own
    // authority. That is anne, not cato: bram removed cato back in step 4, so cato's device is an
    // ex-member's and its roster is legitimately stale. Asking it anything here measures nothing —
    // which cost a bisect to notice, and is worth the sentence.
    const caretakerRef = adminsNow.map((m) => m.webid ?? m.addr)[0];
    check('…and the other remaining member agrees who it is',
      await untilTrue(async () => {
        const asAnne = (await rosterOf(anne, CIRCLE)).filter((m) => m.role === 'admin')
          .map((m) => m.webid ?? m.addr);
        return asAnne.length === 1 && asAnne[0] === caretakerRef;
      }, 15000),
      `bram sees ${String(caretakerRef).slice(0, 8)}, anne sees ${JSON.stringify(
        (await rosterOf(anne, CIRCLE)).filter((m) => m.role === 'admin').map((m) => (m.webid ?? m.addr)?.slice(0, 8)))}`);

    // …and the appointment says WHY it happened, not merely that it did. A caretaker is the one kind
    // of admin nobody chose, and that is exactly what a member needs to be able to read.
    const caretakerRow = adminsNow[0];
    check('…and the roster says it was a handover, not a decision someone took',
      typeof caretakerRow?.adminVia === 'string' && caretakerRow.adminVia.startsWith('caretaker:'),
      `the appointed admin's row says: ${JSON.stringify(caretakerRow?.adminVia)}`);

    // THE ONE THAT MATTERS: the appointment is real authority, not a label. Ask whoever the fold
    // picked to do a thing only an admin may do.
    const successor = [anne, cato].find((n) => n.pubKey === caretakerRef) ?? anne;
    const runsIt = await call(successor, 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'Onder nieuw beheer', agreements: 'de kring loopt door' },
    });
    check('the appointed admin can genuinely run the circle', !runsIt?.error,
      `write said ${JSON.stringify(runsIt)?.slice(0, 110)}`);
    // Deliberately NOT asserted here: that the new rules text appears on the other device. A rules
    // change is STAGED for the member to review and accept — that is what the rules-acceptance
    // statement and the stale-rules banner are for — so it does not land in their store on arrival.
    // A check that it does would be asserting a bug rather than a behaviour.
    check('…and the person who stepped down keeps the circle — stepping back is not leaving',
      hasMember(await rosterOf(bram, CIRCLE), bram.pubKey)
      && (await roleOf(bram, CIRCLE, bram.pubKey)) === 'member',
      `bram's own row: ${await roleOf(bram, CIRCLE, bram.pubKey)}`);
  } catch (err) {
    check('the promotion corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
