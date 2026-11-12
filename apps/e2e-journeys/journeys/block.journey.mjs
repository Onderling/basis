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
// A BLOCK IS ABOUT DIRECT CONTACT, NEVER A CIRCLE (Frits 2026-11-12, after comparing Signal, WhatsApp and Telegram,
// which all keep a block one-on-one). Before, the secure agent dropped everything from the person and refused every send
// to them, circle traffic included: a silent half-removal that made the blocker's view of the circle drift from every
// other member's. Now the block list is kept (alias-aware) and asked only by the DIRECT doors; circle traffic never asks.
// The inbound direct door is walked end to end in apps/basis/test/blockIsDirectOnly.relay.test.js (these journey nodes
// compose no contact channel); here, across three real devices:
//   1. CIRCLE    — the blocked person's circle post still lands on the blocker's device (the circle folds the same
//                  everywhere); their earlier posts stay; the view can still HIDE them on the blocker's device.
//   2. DIRECT    — the blocker's DIRECT send to them is refused at the agent's send gate, with the reason, nothing on
//                  the wire; a circle send to the same address is not.
//   3. BYSTANDER — a third device sees no change.
//   4. REVERSIBLE— unblocking lets direct contact through again.
//   5. PERSON    — the block covers the person, not the address: their per-circle address, and one bound later.
import { checker, declaredOp } from './_util.mjs';
import { bootAppCircle, sendCircleChat, untilTrue, addressOf } from './_app.mjs';
// The projection both shells render their chat through — the hide half lives here, not in a view.
import { mutedActorSet } from '../../basis/src/v2/circleStream.js';

export const name = 'J-block (a block is about direct contact: the circle is untouched, and only the blocker changes)';

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
    const rosterRows = async () =>
      (await anne.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? [];

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

    // ── 1. CIRCLE ───────────────────────────────────────────────────────────────────────────────
    await sendCircleChat(bram, { groupId: CIRCLE, msgId: 'after-block', text: 'hallo?' });
    check('[CIRCLE] the blocked person\'s circle post still lands on the blocker\'s device (the circle is not cut)',
      await untilTrue(() => subjectsOn(anne).includes('after-block')), subjectsOn(anne).join(','));
    check('[CIRCLE] and what they said before stays', subjectsOn(anne).includes('before-1'));
    const hideSet = mutedActorSet([bramAddr], await rosterRows());
    check('[CIRCLE] the view can still hide them on the blocker\'s device (the key resolves to an actor)',
      hideSet.size === 1, JSON.stringify([...hideSet]).slice(0, 120));

    // ── 2. DIRECT ───────────────────────────────────────────────────────────────────────────────
    const direct = await anne.agent.sendPeerMessage(bramAddr, { subtype: 'contact-msg', text: 'hoi', messageId: 'direct-1' });
    check('[DIRECT] the blocker\'s direct send to them is refused at the send gate, with the reason',
      direct?.refused === 'blocked', JSON.stringify(direct)?.slice(0, 120));
    const circleSend = await anne.agent.sendPeerMessage(bramAddr, { subtype: 'circle-address-announce', groupId: CIRCLE }).catch((e) => ({ error: String(e?.message ?? e) }));
    check('[DIRECT] a circle send to the same address is not refused for the block',
      circleSend?.refused !== 'blocked', JSON.stringify(circleSend)?.slice(0, 120));
    check('[DIRECT] the block list covers them (what every direct door asks)', (await saOf(anne).mute.covers(bramAddr)) === true);

    // ── 3. BYSTANDER ────────────────────────────────────────────────────────────────────────────
    check('[BYSTANDER] the third device still receives the same person normally',
      await untilTrue(() => subjectsOn(cato).includes('after-block')),
      subjectsOn(cato).join(','));
    const catoList = await cato.agent.callSkill('basis', 'muted', {});
    check('[BYSTANDER] and has nobody blocked of its own',
      Array.isArray(catoList?.peers) && catoList.peers.length === 0);

    // ── 4. REVERSIBLE ───────────────────────────────────────────────────────────────────────────
    const unblocked = await block(anne, 'unmute', bramAddr);
    check('the unblock is accepted', !unblocked?.error, JSON.stringify(unblocked)?.slice(0, 120));
    const again = await anne.agent.sendPeerMessage(bramAddr, { subtype: 'contact-msg', text: 'toch hoi', messageId: 'direct-2' });
    check('[REVERSIBLE] direct contact goes through again (a door, not a trapdoor)',
      again?.refused !== 'blocked', JSON.stringify(again)?.slice(0, 120));
    await sendCircleChat(bram, { groupId: CIRCLE, msgId: 'after-unblock', text: 'nog steeds die ladder' });
    check('[REVERSIBLE] and the circle goes on as it did', await untilTrue(() => subjectsOn(anne).includes('after-unblock')));

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
    await block(anne, 'mute', bramAddr);
    check('[PERSON] the block covers their per-circle address too (what a direct door there asks)',
      (await saOf(anne).mute.covers(bramCircle)) === true);

    // And once more for an address bound later — a second device, a rotated per-circle address. The
    // block is not re-applied; the one decision already covers it.
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
