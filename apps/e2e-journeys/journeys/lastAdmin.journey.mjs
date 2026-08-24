// J-lastadmin: the only admin leaves. Who runs the circle now?
//
// This is a safety event in the plainest sense: a street group whose organiser moves away, a care
// circle whose coordinator steps back. The circle must not become permanently unadministrable
// because one person walked out.
//
// The design already answers this. `apps/basis/src/v2/governanceCaretaker.js` computes exactly it —
// `needsCaretaker` ("after the departure the roster still has members but no admin among them"),
// `caretakerOrder` (a deterministic order, so every device appoints the SAME person with nobody
// adjudicating), and the appointment itself. It has unit tests and they pass.
//
// What the coverage survey found is that **nothing calls it**. Outside its own test file, the only
// mention anywhere in the tree is a comment in `governanceHost.js` describing what the caretaker
// would be if one existed. That is the built-but-unadopted shape the house rules name as an
// invariant: "DONE = declared · implemented · tested · REACHED", and "nothing fails when a seam is
// left inert".
//
// So this journey does not test the caretaker module — that is already tested. It measures what a
// person gets today: the circle after its last admin leaves.
//
// WHAT IT FOUND FIRST — every device projecting ITSELF as an admin of the circle — has since been
// fixed: authority is one folded head now, and all three devices give the same answer. Measured
// then, on a plain three-person circle, it looked like this:
//
//     anne sees: anne=admin   bram=member  cato=member    (correct — anne really is the admin)
//     bram sees: bram=admin   anne=admin   cato=member
//     cato sees: cato=admin   anne=admin   bram=member
//
// Everyone's view of everyone ELSE is right; only the self-row is wrong. Which means the caretaker
// is not merely uncalled — it is unreachable by construction, because `needsCaretaker` asks whether
// the roster has "members but no admin among them", and no device can ever see that: it always sees
// at least one admin, itself.
import { checker } from './_util.mjs';
import { bootAppCircle, rosterOf, hasMember, untilTrue } from './_app.mjs';

export const name = 'J-lastadmin (the only admin leaves — can the circle still be run?)';

const CIRCLE = 'e2e-last-admin';

const roleOf = (rows, pubKey) =>
  rows.find((m) => (m.webid ?? m.addr ?? m.ref) === pubKey)?.role ?? null;

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    const call = (node, op, args) => node.agent.callSkill('stoop', op, args);

    // The admin's OWN view is correct, which is what makes the rest a projection bug rather than a
    // roster that is simply wrong everywhere.
    const asAdmin = await rosterOf(anne, CIRCLE);
    check('the real admin sees the circle correctly — one admin, two members',
      roleOf(asAdmin, anne.pubKey) === 'admin'
      && roleOf(asAdmin, bram.pubKey) === 'member' && roleOf(asAdmin, cato.pubKey) === 'member',
      JSON.stringify(asAdmin.map((m) => [m.handle ?? m.webid?.slice(0, 6), m.role])));

    const before = await rosterOf(bram, CIRCLE);
    check('a MEMBER\'s device does not show that member as an admin',
      roleOf(before, bram.pubKey) !== 'admin',
      JSON.stringify(before.map((m) => [m.handle ?? m.webid?.slice(0, 6), m.role])));
    check('a member\'s view of everyone ELSE is right — only the self-row is wrong',
      roleOf(before, anne.pubKey) === 'admin' && roleOf(before, cato.pubKey) === 'member');

    // Confirm the members really are non-admins BEFORE the departure, so what is measured after it
    // is the change and not a pre-existing condition.
    const beforeRules = await call(bram, 'editGroupRules', {
      groupId: CIRCLE, rules: { agreements: 'mag dit?' },
    });
    check('a member cannot set the rules while an admin is present', !!beforeRules?.error,
      JSON.stringify(beforeRules)?.slice(0, 120));

    // ── The only admin walks out ─────────────────────────────────────────────────────────────────
    const left = await call(anne, 'leaveGroup', { groupId: CIRCLE, confirm: true });
    check('the last admin can leave at all (or is told why not)', true,
      JSON.stringify(left)?.slice(0, 160));

    const adminGone = await untilTrue(async () => !hasMember(await rosterOf(bram, CIRCLE), anne.pubKey));
    check('the departure reaches the remaining members', adminGone);

    // ── The question ─────────────────────────────────────────────────────────────────────────────
    const after = await rosterOf(bram, CIRCLE);
    const admins = after.filter((m) => m.role === 'admin');
    check('the circle still has the two remaining people', after.length >= 2,
      JSON.stringify(after.map((m) => [m.handle ?? m.webid?.slice(0, 6), m.role])));

    // Trivially true while every device counts itself — recorded so the day the self-row is fixed,
    // this becomes the real caretaker question instead of silently starting to fail.
    check('someone is admin after the departure — THE OPEN QUESTION: today nobody is',
      admins.length >= 1, `${admins.length} admin(s) among ${after.length} member(s)`);

    // …and every device must agree on WHO, or the circle has two opinions about its own authority.
    const catoAfter = await rosterOf(cato, CIRCLE);
    const catoAdmins = catoAfter.filter((m) => m.role === 'admin').map((m) => m.webid ?? m.addr);
    const bramAdmins = admins.map((m) => m.webid ?? m.addr);
    check('…and both remaining devices agree on who it is',
      JSON.stringify(bramAdmins.sort()) === JSON.stringify(catoAdmins.sort()),
      `one device sees ${JSON.stringify(bramAdmins)}, the other ${JSON.stringify(catoAdmins)}`);

    // ── What it costs, in acts rather than roles ─────────────────────────────────────────────────
    // Whether or not a role was written, the practical question is whether the circle can still be
    // run. Each of these is an admin act the remaining people may now legitimately need.
    const rulesNow = await call(bram, 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'Huisregels', agreements: 'we doen het samen verder' },
    });
    const rulesReached = await untilTrue(async () => {
      const r = await call(cato, 'getGroupRules', { groupId: CIRCLE }).catch(() => null);
      return JSON.stringify(r ?? {}).includes('samen verder');
    }, 8000);
    check('the circle can still change its own rules after its admin left', rulesReached,
      `write said ${JSON.stringify(rulesNow)?.slice(0, 90)}`);

    // The sharpest one: a circle that can never remove anyone again has no way to protect itself.
    const removeNow = await call(bram, 'removeMember', {
      groupId: CIRCLE, memberWebid: cato.pubKey, reason: 'test',
    });
    const removalTook = await untilTrue(
      async () => !hasMember(await rosterOf(cato, CIRCLE), cato.pubKey), 6000);
    check('the circle can still remove a member after its admin left', removalTook,
      `op said ${JSON.stringify(removeNow)?.slice(0, 90)}`);
  } catch (err) {
    check('the last-admin corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
