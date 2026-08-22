// J-scope: two circles, one person in both. What crosses, and what must not.
//
// Every authority tested so far in this suite resolves through a ROLE, a KEY, or a PHRASE. This one
// is a different surface: **scope**. Nobody is doing anything wrong here — no eviction, no forged
// signature, no stranger at a door. Two ordinary circles simply exist, one person belongs to both,
// and the question is whether the walls between them hold when nothing is attacking them.
//
// That matters because the failure mode is silent by nature. A leak between circles produces no
// error and no refusal; it produces a person seeing something they were never meant to, in a place
// that looks completely normal.
//
// Two claims, and the second is the one this architecture stakes a real promise on:
//
//   1. CONTENT IS PER-CIRCLE. What is said and done in one circle does not appear in the other,
//      on anyone's device — including the device of the person who is in both.
//   2. THE SAME PERSON IS UNLINKABLE ACROSS CIRCLES. Each circle sees a different per-circle
//      address for them. Two circles comparing rosters cannot tell they hold the same human. This
//      is the whole point of a per-circle address, and nothing has ever checked it end to end.
//
//   Anne  — in both circles (the bridge, and the person whose privacy is at stake)
//   Bram  — the first circle only
//   Cato  — the second circle only. Bram and Cato must never learn of each other.
import { checker } from './_util.mjs';
import { bootAppCircle, formCircle, rosterOf, hasMember, untilTrue, sendCircleChat } from './_app.mjs';

export const name = 'J-scope (two circles, one person in both — what crosses, and what must not)';

const HOUSE = 'e2e-scope-house';
const STREET = 'e2e-scope-street';

const chatSubjects = (node, circleId) =>
  node.chatRail.storedStatements(circleId).map((s) => s?.body?.subject);

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let house = null;

  try {
    // ONE person genuinely in two circles. Cato is booted onto the same relay but NOT into the house;
    // the street is then formed from the SAME anne device plus cato. Booting a second set of people
    // would make the unlinkability claim below vacuous — two different humans naturally have
    // different addresses, which proves nothing about whether one human can be tracked across circles.
    house = await bootAppCircle({
      relayUrl, circleId: HOUSE, handles: ['anne', 'bram'], outsiders: ['cato'],
    });
    const [anne, bram] = house.people;
    const [cato] = house.outsiders;
    await formCircle({ admin: anne, joiners: [cato], circleId: STREET, handles: ['cato'] });
    // The same device, in both circles.
    const anneElsewhere = anne;

    check('one person is in BOTH circles, on one device',
      hasMember(await rosterOf(anne, HOUSE), bram.pubKey)
      && hasMember(await rosterOf(anne, STREET), cato.pubKey));
    check('the first circle holds its own two people',
      hasMember(await rosterOf(anne, HOUSE), bram.pubKey));
    check('the second holds its own', hasMember(await rosterOf(cato, STREET), anneElsewhere.pubKey));

    // ── 1. CONTENT IS PER-CIRCLE ─────────────────────────────────────────────────────────────────
    await sendCircleChat(anne, { groupId: HOUSE, msgId: 'house-1', text: 'de sleutel ligt onder de mat' });
    check('a message lands in its own circle',
      await untilTrue(() => chatSubjects(bram, HOUSE).includes('house-1')));

    await sendCircleChat(cato, { groupId: STREET, msgId: 'street-1', text: 'buurtfeest zaterdag' });
    check('and the other circle\'s message lands in ITS circle',
      await untilTrue(() => chatSubjects(anneElsewhere, STREET).includes('street-1')));

    // The walls, asked of every device that could possibly hold the wrong thing.
    check('THE HOUSE\'S MESSAGE DOES NOT APPEAR IN THE STREET',
      !chatSubjects(cato, STREET).includes('house-1')
      && !chatSubjects(anneElsewhere, STREET).includes('house-1'));
    check('…nor the street\'s in the house',
      !chatSubjects(bram, HOUSE).includes('street-1')
      && !chatSubjects(anne, HOUSE).includes('street-1'));

    // Not even under the other circle's id on the same device — the store is scoped, not filtered.
    check('a device holds nothing at all for a circle it is not in',
      chatSubjects(bram, STREET).length === 0 && chatSubjects(cato, HOUSE).length === 0,
      `${chatSubjects(bram, STREET).length} / ${chatSubjects(cato, HOUSE).length}`);

    // Tasks travel a different lane than chat, so the wall has to hold there too.
    const houseTask = await anne.agent.callSkill('tasks', 'addTask', {
      circleId: HOUSE, text: 'cv-ketel laten nakijken',
    });
    check('a task lands in its own circle', !!houseTask?.itemId);
    const leakedTask = await untilTrue(async () => {
      const r = await cato.agent.callSkill('tasks', 'listOpen', { circleId: HOUSE });
      return ((r?.items ?? []).some((t) => t.id === houseTask.itemId));
    }, 4000);
    check('a task does not reach someone in the other circle', !leakedTask);

    // ── 2. THE PERSON IN BOTH CIRCLES SEES THEM SEPARATELY ───────────────────────────────────────
    // The bridge device is the interesting one: it legitimately holds both, and must keep them apart.
    check('the person in both circles keeps them apart on their own device',
      chatSubjects(anne, HOUSE).includes('house-1')
      && !chatSubjects(anne, HOUSE).includes('street-1'));

    // ── 3. NOBODY LEARNS OF THE OTHER CIRCLE'S PEOPLE ────────────────────────────────────────────
    // [F-018] The roster projection injects the CALLER'S OWN ROW — even for a circle they are not in
    // at all. Asking about a foreign circle returns exactly one member: yourself. That is the same
    // self-row defect that makes every device believe it is an admin, seen from the other side, and
    // it is a cleaner statement of the bug than "the role is wrong": the row should not exist.
    // (`listGroupRoster` gets this right and answers empty — the gate is in one projection, not both.)
    const bramSeesStreet = await rosterOf(bram, STREET);
    const onlySelf = bramSeesStreet.length === 1
      && (bramSeesStreet[0].webid ?? bramSeesStreet[0].addr) === bram.pubKey;
    check('[F-018] a member of one circle cannot read the other\'s roster',
      bramSeesStreet.length === 0,
      onlySelf ? 'one row, and it is the caller\'s own — the injected self-row'
        : JSON.stringify(bramSeesStreet)?.slice(0, 140));
    check('…at least it leaks nobody ELSE from the other circle',
      !bramSeesStreet.some((m) => (m.webid ?? m.addr) !== bram.pubKey),
      `${bramSeesStreet.length} row(s)`);

    check('the two circles\' members never learn of each other',
      !hasMember(await rosterOf(bram, HOUSE), cato.pubKey)
      && !hasMember(await rosterOf(cato, STREET), bram.pubKey));

    // ── 4. UNLINKABILITY — the promise a per-circle address exists to keep ───────────────────────
    // Two circles comparing rosters must not be able to tell they hold the same person. This is
    // asserted on the ADDRESSES the rosters actually carry, not on what a UI chooses to show.
    const addrIn = async (node, circleId, ofPubKey) => {
      const rows = await rosterOf(node, circleId);
      const row = rows.find((m) => (m.webid ?? m.addr ?? m.ref) === ofPubKey);
      return row?.circleAddress ?? row?.addr ?? null;
    };
    // Each circle's view of THE SAME PERSON, read from the other members' devices.
    const houseAddr = await addrIn(bram, HOUSE, anne.pubKey);
    const streetAddr = await addrIn(cato, STREET, anne.pubKey);
    check('each circle records a per-circle address for its members',
      !!houseAddr && !!streetAddr, `${String(houseAddr).slice(0, 10)}… / ${String(streetAddr).slice(0, 10)}…`);
    check('THE SAME PERSON IS UNLINKABLE — the two circles hold different addresses for one human',
      !!houseAddr && !!streetAddr && houseAddr !== streetAddr,
      `${String(houseAddr).slice(0, 12)}… vs ${String(streetAddr).slice(0, 12)}…`);

    // And the circle-scoped address is not simply the canonical identity wearing a hat: if the
    // roster carried the person's own long-term key, every circle would be trivially linkable.
    check('a circle\'s address is not the person\'s canonical key',
      houseAddr !== anne.pubKey && streetAddr !== anne.pubKey);
  } catch (err) {
    check('the scope corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await house?.close?.().catch(() => {});
  }
  return results;
}
