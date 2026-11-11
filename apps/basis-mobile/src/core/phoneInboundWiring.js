/**
 * The phone's inbound wiring, composed once — everything ChatScreen used to build inline EXCEPT the paint.
 *
 * The handler map itself is shared by every shell (`buildInboundWiring`, apps/basis/src/v2/inboundWiring.js).
 * What sat around it in the screen was still composition, not paint: the governance rail and what a governance
 * change folds, the lane options (pod reads, the data move, the preserved rules statements), the receipt
 * receiver, the delivery ladder's rehydrate, the contact channel's landed hook, how a landed contact turn is
 * persisted. Built inside a screen, nothing outside the screen could compose the phone the way the phone
 * composes itself — so a test of "the phone receives X" had to reassemble it, and a reassembly proves only
 * itself. Here, ChatScreen and the Node harness (test/support/mobileNode.js) call the SAME function; the
 * screen hands in only where things are painted.
 *
 * @param {object} p
 * @param {object} p.bundle               the booted agent bundle
 * @param {object} p.agent                bundle.agent
 * @param {function} p.callSkill          bundle.callSkill
 * @param {object} [p.contactChannel]
 * @param {Map}    p.pendingRedeems       the bundle's shared redeem map (so a launcher join correlates here too)
 * @param {object} [p.sharedWithMeStore]
 * @param {object} p.eventLog             the device log
 * @param {object} [p.deliveryStateMap]   the shared per-message delivery map
 * @param {function} [p.chatStoredReceipt] the App-owned receipt sender
 * @param {function} [p.onCirclesChanged] the launcher re-reads its circles
 * @param {object} [p.recipe]             { pendingStore, dedup } or null
 * @param {object} [p.rules]              { pendingStore, dedup } or null
 * @param {object} [p.circlePolicyLane]
 * @param {object} p.paint                the screen's own reactions:
 *   - addMainBubble(bubble)                         a calendar line in the main thread
 *   - chatCatchUpOffer({count, approxBytes, allow}) ask the person before a large chat catch-up
 * @returns {{ handlers: object, lanes: object, publishEvent: function }}
 */
import { buildInboundWiring } from '../../../basis/src/v2/inboundWiring.js';
import { makeReceiptReceiver, contactReceiptAddresses, rehydrateDeliveryState } from '../../../basis/src/v2/deliverySettings.js';
import { makeGovernanceRail } from '../../../basis/src/v2/governanceAppWiring.js';
import { applyRulesUpdates, preservedRulesStatementsFor } from '../../../basis/src/v2/rulesUpdateLane.js';
import { sealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import { pushContactReply } from './contactReplyInbox.js';
import { circleResolveRef, circlePodReadSince, circleSendDataMove, circleControlAgentRouter, refreshCircleKeyEventsFromLane } from './circlePods.js';

export function buildPhoneInboundWiring({
  bundle, agent, callSkill, contactChannel = null, pendingRedeems, sharedWithMeStore = null,
  eventLog, deliveryStateMap = null, chatStoredReceipt = null, onCirclesChanged = null,
  recipe = null, rules = null, circlePolicyLane = null,
  paint,
}) {
  const { addMainBubble, chatCatchUpOffer } = paint;

  // Mobile publishEvent — fans into the eventLog so /logs picks up
  // inbound notifications (parity with web's publishEventRef →
  // event-router).
  const publishEvent = (e) => {
    if (!e || typeof e !== 'object') return;
    const evt = {
      ...e,
      id: e.id ?? `peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: e.ts ?? Date.now(),
    };
    try { eventLog?.append?.(evt); } catch { /* defensive */ }
  };

  // A DM that arrived DIRECTLY: store it, which is also what hands it to this person's other
  // devices. Keyed on the PERSON behind the sender (the channel's `contactId`), the key every row opens.
  // …and the persist decides whether THIS turn brought a hidden contact back: the live push then
  // carries the mark, so an open thread paints the marker above the bubble (web parity).
  const landContactTurn = ({ contactId, fromAddr, text, buttons, messageId, replyTo, ts }) => {
    // keyed by the PERSON the channel resolved behind the sender address (a turn over the pair route comes
    // from their per-circle address; keyed by that it sat in a thread no row opens — 2026-09-19)
    contactChannel?.persistInbound?.({ contactId: contactId ?? fromAddr, fromAddr, text, buttons, messageId, replyTo, ts })
      ?.then?.((r) => { if (r?.returned) pushContactReply({ fromAddr, threadId: fromAddr, messageId, returned: true, markerOnly: true }); })
      ?.catch?.(() => { /* durability is best-effort; the live push still lands */ });
  };

  // Delivery honesty (receiver half) — who is ALLOWED to tell us a message arrived. Built here rather
  // than at the handler so the roster cache lives as long as the peer wiring does. The shell injects
  // only its two adapters (the log it already owns, the roster skill); the rule is shared with web.
  const applyIncomingReceipt = deliveryStateMap
    ? makeReceiptReceiver({
      deliveryMap: deliveryStateMap,
      eventLog,
      listCircleMembers: async (circleId) => {
        const r = await callSkill('pinboard', 'listGroupMembers', { groupId: circleId });
        return Array.isArray(r?.members) ? r.members : [];
      },
      // A turn to a CONTACT: only that contact may confirm it (web parity — canonical address, or any address of
      // the pair circle's roster). Late-bound through the bundle.
      contactAddressesOf: (msgId) => (contactChannel ? contactReceiptAddresses({ channel: contactChannel, pair: bundle?.pairRoster ?? null })(msgId) : null),
      // Receipt-keyed outbox removal (web parity): their app confirmed the message arrived, so the
      // copy still held for THEM is obsolete — a presence flush would resend it.
      removeHeld: (a) => bundle?.agent?.removeHeld?.(a),
    })
    : null;
  // Rebuild the delivery ladder from the ONE log (web parity — the outbox-as-projection): my recent
  // sends seed maybe-received (restoring the receipt gate's key set after a restart), logged receipts
  // advance to stored.
  if (deliveryStateMap && eventLog) {
    try { rehydrateDeliveryState({ eventLog, deliveryMap: deliveryStateMap, localActor: 'me' }); }
    catch { /* the live ladder still works from here on */ }
  }

  // A contact's turn that lands in its thread answers with the SAME delivery receipt a circle member sends, under the
  // same per-person setting (the App-owned sender): the sender's own bubble moves to "their app has it" (web parity:
  // circleApp hands circleContactChannel the same sender).
  try { contactChannel?.setLandedHook?.((info) => chatStoredReceipt?.(info)); } catch { /* the thread works without receipts */ }

  const govRail = bundle?.agent?.circleIdentityFor
    ? makeGovernanceRail({ eventLog, circleIdentityFor: bundle.agent.circleIdentityFor, myRef: '', callSkill: bundle.callSkill })
    : null;
  // the policy lane folds with this rail — a save brings the lane's head up to date before it counts past it
  if (govRail) circlePolicyLane?.useRail(govRail);
  // Any governance change (the live fan, or a catch-up batch) may carry a rules-update statement —
  // fold it into the local rules head; the pre-scan is cheap and no-ops for vote churn.
  const govChanged = (cid) => {
    if (govRail) applyRulesUpdates({ rail: govRail, callSkill: bundle.callSkill, circleId: cid }).catch(() => {});
    // …and the circle's policy, the same way (a joiner catches the founder's up here)
    if (govRail) circlePolicyLane?.apply(cid, govRail).catch(() => {});
  };
  const { handlers, lanes } = buildInboundWiring({
    agent, callSkill, publishEvent,
    eventLog, govRail, onGovChange: govChanged,
    lanes: {
      govRail,
      eventLog,
      resolveRef: circleResolveRef,
      podReadSince: circlePodReadSince,
      dataMoveFor: circleSendDataMove,
      // The durable-head serve: the preserved rules-update statement still reaches a member who was
      // offline past the lane's audit window.
      extraGovStatementsFor: async (cid) => [
        ...await preservedRulesStatementsFor({ callSkill: bundle.callSkill, circleId: cid }),
        ...(circlePolicyLane ? await circlePolicyLane.preserved(cid) : []),
      ],
      on: {
        govChange: govChanged,
        // a landed membership change may be this person's own leave, signed on the main device: the launcher re-reads
        // its circles (web parity — without it the left circle's tile stays until the next focus)
        membershipChange: () => { onCirclesChanged?.(); },
        keyChange: (cid) => refreshCircleKeyEventsFromLane(bundle?.agent?.keyRail, cid).catch(() => {}),
        chatLanded: ({ msgId, circleId: cid, fromPeerAddr, source }) => {
          try { chatStoredReceipt?.({ msgId, circleId: cid, fromPeerAddr, source }); }
          catch { /* the receipt is best-effort; the message landed either way */ }
        },
        // Above the auto-allow ceiling the person gets the real question — the screen asks it.
        chatCatchUpOffer,
        // A turn one of MY OWN devices took delivery of: the channel decides which persist path it
        // takes and says which side of the conversation it is, so an open thread paints it right.
        ownDeviceTurn: async (wire) => {
          const landed = await contactChannel.applyOwnDeviceTurn(wire);
          if (landed.deduped) return;
          pushContactReply({
            fromAddr: landed.fromAddr ?? landed.peerAddr, threadId: landed.contactId,
            text: landed.text, buttons: landed.buttons, replyTo: landed.replyTo,
            messageId: landed.messageId, file: landed.file, origin: landed.origin,
            ...(landed.returned ? { returned: true } : {}),
          });
        },
      },
    },
    // a contact's turn and a person's message land in the thread and the open thread screen
    contactChannel,
    onContactReply: (turn) => { landContactTurn(turn); pushContactReply(turn); },
    // the bundle's shared redeem map, so a join made from the launcher correlates here too
    pendingRedeems,
    // a member admitted into a PAIR circle is its co-admin (the pair roster's rule); the launcher re-reads its circles
    // (an admin's own admission is a local write, so the membership lane's signal never fires for it)
    onAdmitted: (a) => { onCirclesChanged?.(); return bundle?.pairRoster?.onAdmitted?.(a); },
    // Sealed-circle audience (the custody arc): a proven device address joins the group key's readers when THIS
    // device holds the circle's producer; no-ops otherwise.
    grantSealedAudience: (circleId, address) => circleControlAgentRouter.grantRecipient({
      groupId: circleId, publicKey: sealingPublicKeyFromNetworkKey(address),
    }),
    applyIncomingReceipt: (payload, from) => applyIncomingReceipt?.(payload, from),
    nearbyRoom: bundle?.nearbyRoom ?? null,
    recipe,
    rules,
    calendar: { addMainBubble },
    // A peer-wire file, or a reply to one of OUR noticeboard posts, lands in THAT SENDER's contact thread: persisted
    // through the shared channel (the thread is the received copy's durable home) and pushed live to an open
    // ContactThreadScreen through the same inbox every DM reply rides.
    deliverToContactThread: (turn) => {
      contactChannel?.persistInbound?.(turn)?.catch?.(() => { /* durability is best-effort; the live push below still lands */ });
      pushContactReply({
        fromAddr: turn.fromAddr, threadId: turn.contactId, text: turn.text,
        ...(turn.file ? { file: turn.file } : {}),
        ...(turn.sealed ? { sealed: turn.sealed } : {}),
        ...('replyTo' in turn ? { replyTo: turn.replyTo } : {}),
      });
    },
    notePeer: (addr) => bundle?.peerGraph?.upsert?.({ pubKey: addr, lastSeen: Date.now() })?.catch?.(() => {}),
    sharedWithMeStore,
    noticeboardLanded: true,
  });
  // Hand the bundle the catch-ups, so a join made from any screen pulls the circle's lanes (`onCircleJoined`).
  try { if (bundle) bundle.laneCatchUps = lanes.catchUps; } catch { /* a bundle without the slot */ }
  return { handlers, lanes, publishEvent };
}
