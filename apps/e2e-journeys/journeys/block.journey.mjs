// Blocking a PERSON — the whole-device kind, not the per-circle kind.
//
// Two different things share the word "mute" in this product and they must not be confused:
//   • mute.journey.mjs — muting a CIRCLE that got noisy. A per-circle override; the people in it are
//     unaffected everywhere else.
//   • this one — blocking a PERSON. Not a filter over one room's traffic: a decision about someone,
//     which has to hold at every place they can reach you and follow them across the addresses they
//     speak from. Half a block is worse than none, because the user believes they are done.
//
// Until this convergence there were two block sets on a device: the shell's (durable, at the transport
// boundary) and one inside the closed-group app (a `new Set()` per process, gone on reload, written by
// a door the shell's own button did not use). Blocking someone from the noticeboard filled the second;
// their next envelope arrived anyway, and after a reload even the filtering stopped. There is one set
// now — the shell's — and the app reads it.
//
// Five claims, one per way a block can be half:
//   1. HIDE      — their posts stop appearing on the blocker's device.
//   2. REFUSE    — their envelopes are dropped at the blocker's boundary, and the drop is COUNTED
//                  (a silent drop and a flaky transport look identical otherwise).
//   3. BYSTANDER — a block is one person's decision about another; a third device sees no change.
//                  This is the claim that fails loudest if a block ever leaks onto the wire.
//   4. REVERSIBLE— unblocking restores traffic. A door, not a trapdoor.
//   5. PERSON    — blocking someone blocks the person, not the address: their second address is
//                  refused too, without the blocker doing anything more.
import { checker, declaredOp, wait } from './_util.mjs';
import { bootAppCircle, sendCircleChat, untilTrue, addressOf } from './_app.mjs';

export const name = 'J-block (blocking a person holds everywhere, and only for the blocker)';

const CIRCLE = 'e2e-block';

const subjectsOn = (node) =>
  node.chatRail.storedStatements(CIRCLE).map((s) => s?.body?.subject);
const saOf = (node) => node.agent.sa;

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    // The reachability gate: both doors must be DECLARED, or this journey proves something no user
    // can reach. `muted` is the read the "Blocked" list under Me is built on.
    await declaredOp('basis', 'mute');
    await declaredOp('basis', 'unmute');
    await declaredOp('basis', 'muted');
    check('block / unblock / list are declared (twin-reachability gate)', true);

    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    const block = (node, op, peer) => node.agent.callSkill('basis', op, { peer });

    // A baseline, so "nothing arrived" can be told apart from "nothing ever worked".
    await sendCircleChat(bram, { groupId: CIRCLE, msgId: 'before-1', text: 'ik heb een ladder' });
    check('before the block, Bram reaches Anne',
      await untilTrue(() => subjectsOn(anne).includes('before-1')));
    check('…and Cato as well',
      await untilTrue(() => subjectsOn(cato).includes('before-1')));

    // ── Anne blocks Bram ────────────────────────────────────────────────────────────────────────
    const bramAddr = addressOf(bram);
    const bramCircle = await bram.agent.circleAddressFor?.(CIRCLE);
    const blocked = await block(anne, 'mute', bramAddr);
    check('the block is accepted', !blocked?.error, JSON.stringify(blocked)?.slice(0, 120));

    const listed = await anne.agent.callSkill('basis', 'muted', {});
    check('the blocked person is on the list the "Blocked" view reads',
      Array.isArray(listed?.peers) && listed.peers.includes(bramAddr),
      JSON.stringify(listed?.peers)?.slice(0, 120));

    // ── 1. HIDE + 2. REFUSE ─────────────────────────────────────────────────────────────────────
    const dropsBefore = saOf(anne).securityStatus().mutedDrops ?? 0;
    await sendCircleChat(bram, { groupId: CIRCLE, msgId: 'after-block', text: 'hallo?' });
    await wait(1200);   // no event to await on: the claim IS that nothing happens on Anne's device

    check('[HIDE] the blocked person\'s post does not appear on the blocker\'s device',
      !subjectsOn(anne).includes('after-block'), subjectsOn(anne).join(','));

    const dropsAfter = saOf(anne).securityStatus().mutedDrops ?? 0;
    check('[REFUSE] the envelope was refused at the boundary, and counted',
      dropsAfter > dropsBefore, `mutedDrops ${dropsBefore} → ${dropsAfter}`);

    // ── 3. BYSTANDER ────────────────────────────────────────────────────────────────────────────
    // Cato never asked for anything. If a block ever travelled — as a statement on the lane, as a
    // roster effect — this is where it would show. Blocking must be invisible to everyone but the
    // blocker, including the person blocked.
    check('[BYSTANDER] the third device still receives the same person normally',
      await untilTrue(() => subjectsOn(cato).includes('after-block')),
      subjectsOn(cato).join(','));
    const catoList = await cato.agent.callSkill('basis', 'muted', {});
    check('[BYSTANDER] and has nobody blocked of its own',
      Array.isArray(catoList?.peers) && catoList.peers.length === 0);

    // ── 4. REVERSIBLE ───────────────────────────────────────────────────────────────────────────
    // The post sent DURING the block stays gone — it was refused, not held. What must come back is
    // the NEXT one; a block that silently queued would deliver a backlog here, which is its own bug.
    const unblocked = await block(anne, 'unmute', bramAddr);
    check('the unblock is accepted', !unblocked?.error, JSON.stringify(unblocked)?.slice(0, 120));

    await sendCircleChat(bram, { groupId: CIRCLE, msgId: 'after-unblock', text: 'nog steeds die ladder' });
    check('[REVERSIBLE] the next post arrives again (a door, not a trapdoor)',
      await untilTrue(() => subjectsOn(anne).includes('after-unblock')));
    check('[REVERSIBLE] and the refused one did NOT arrive late (refused, not queued)',
      !subjectsOn(anne).includes('after-block'));

    // ── 5. PERSON, not address ──────────────────────────────────────────────────────────────────
    // The claim the other four quietly depend on. Anne blocked ONE address — the canonical one, the
    // only one a post's author line gives her. But circle traffic does not arrive from that address:
    // every member speaks in a circle from a PER-CIRCLE address, so the envelope [REFUSE] dropped
    // above bore an address Anne has never seen and never blocked. It was refused because the
    // resolver fans the block across the addresses her device knows belong to him.
    //
    // This is asserted separately, and not only through the message legs, because the failure mode is
    // silent and total: with the fan skipped, every check above still passes on the surface (the
    // block is stored, the list shows it) while nothing is actually blocked. That is how it shipped.
    check('[PERSON] circle traffic comes from an address that was never blocked',
      !!bramCircle && bramCircle !== bramAddr, `${String(bramCircle).slice(0, 12)}… vs ${bramAddr.slice(0, 12)}…`);
    const circleAliases = await saOf(anne).resolver.aliasesFor(bramCircle);
    check('[PERSON] …which the blocker\'s device knows is the same person',
      Array.isArray(circleAliases) && circleAliases.includes(bramAddr),
      JSON.stringify(circleAliases)?.slice(0, 140));

    // And once more for an address bound later — a second device, a rotated per-circle address. The
    // block is not re-applied; the one decision already covers it.
    await block(anne, 'mute', bramAddr);
    const secondAddr = `${bramAddr}#circle-2`;
    saOf(anne).registerPeerAddress?.(secondAddr, bramAddr);
    const secondAliases = await saOf(anne).resolver.aliasesFor(secondAddr);
    check('[PERSON] an address bound AFTER the block is covered by it too',
      Array.isArray(secondAliases) && secondAliases.some((a) => saOf(anne).mute.has(a)),
      JSON.stringify(secondAliases)?.slice(0, 140));
  } finally {
    await circle?.close?.();
  }

  return results;
}
