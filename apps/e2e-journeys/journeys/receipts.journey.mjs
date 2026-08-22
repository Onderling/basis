// J-receipts: "did it arrive?" — and the privacy promise attached to the answer.
//
// The delivery model here is unusually deliberate: a transport ack is NOT evidence the product will
// show you, because a device acks whatever its owner's receipt setting says, so reporting it would
// make a receipts-off peer identifiable by where their ladder stops. The only positive evidence is a
// receipt the recipient CHOSE to send. Everything else is `maybe-received` — it may well have
// arrived, and we do not know.
//
// That reasoning has good hermetic coverage (`deliveryPrivacyIndistinguishable.test.js`). What has
// never happened is a receipt crossing a real wire between two real agents — and a seam that is
// green on both sides and dead in the middle is exactly the shape of the last two findings.
//
// The claims:
//   1. HONESTY    — a sent message never reports better than `maybe-received` on the transport ack.
//   2. THE RECEIPT — with receipts on, it crosses and the sender's state advances.
//   3. THE PROMISE — with receipts OFF, the sender's state is the SAME as for a peer who is simply
//      offline. Not similar: identical. That is the whole privacy claim, and it is only meaningful
//      when both are measured in one run, which is what this journey does.
//   4. THE GATES  — a receipt for a message I never sent is refused, and so is one from someone the
//      circle's roster does not know.
//
// STOOD IN FOR, stated plainly: in the shells the receipt is triggered by the chat inbox's `onStored`
// callback (`circleApp.js:7561`). The node harness lands chat through the RAIL instead and has no
// such callback, so this journey calls the production `makeReceiptSender` hook itself at the moment
// the receiver's rail stores the message. Everything downstream of that — the receipt on the wire,
// its validation, the roster check, the map advance — is the real code.
import { checker } from './_util.mjs';
import { bootAppCircle, untilTrue, sendCircleChat, goDark } from './_app.mjs';
import { createDeliveryStateMap, DELIVERY } from '@onderling/kring-host/deliveryState';
import { makeReceiptSender, makeReceiptReceiver } from '../../basis/src/v2/deliverySettings.js';
import { deliveryAfterSend, RECEIPT_MESSAGE } from '../../basis/src/v2/deliveryState.js';

export const name = 'J-receipts (did it arrive — and what a silent peer is allowed to reveal)';

const CIRCLE = 'e2e-receipts';

/** The delivery half of a device, wired as the shells wire it. */
function deliveryFor(node, { sendReceipts = true } = {}) {
  const map = createDeliveryStateMap();
  const settings = { sendReceipts };
  return {
    map,
    settings,
    // The SENDER half: what this device does when it stores someone else's message.
    onStored: makeReceiptSender({
      getSettings: () => settings,
      sendTo: (to, payload) => node.agent.sendPeerMessage(to, payload),
    }),
    // The RECEIVER half: who is allowed to tell this device a message arrived.
    applyReceipt: makeReceiptReceiver({
      deliveryMap: map,
      eventLog: node.chatEventLog,
      listCircleMembers: async (circleId) => {
        const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId })
          .catch(() => null);
        return Array.isArray(r?.members) ? r.members : [];
      },
      removeHeld: (a) => node.agent.removeHeld?.(a),
    }),
  };
}

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;

    const mine = deliveryFor(anne);
    const theirs = deliveryFor(bram, { sendReceipts: true });
    const quiet = deliveryFor(cato, { sendReceipts: false });   // this person turned receipts off

    // Route inbound receipts into the sender's real receiver half.
    const inner = anne._routerRef.fn;
    anne._routerRef.fn = (env) => {
      if (env?.payload?.subtype === RECEIPT_MESSAGE) {
        mine.applyReceipt(env.payload, env.from);
        return undefined;
      }
      return inner?.(env);
    };

    /** Send a message the way a shell does, marking it pending BEFORE the fan — the map's key set is
     *  the gate that stops anyone advancing a message this device never sent. */
    const send = async (msgId, text) => {
      mine.map.set(msgId, DELIVERY.PENDING);
      await sendCircleChat(anne, { groupId: CIRCLE, msgId, text });
      mine.map.set(msgId, deliveryAfterSend());
      return msgId;
    };

    /** The receiver's app storing it — the shells' inbox callback, called here at the same moment. */
    const theyStore = async (who, msgId) => {
      const landed = await untilTrue(() => who.node.chatRail.storedStatements(CIRCLE)
        .some((s) => s?.body?.subject === msgId));
      if (landed) await who.delivery.onStored({ msgId, fromPeerAddr: anne.pubKey, source: 'receiver' });
      return landed;
    };
    const withBram = { node: bram, delivery: theirs };
    const withCato = { node: cato, delivery: quiet };

    // ── 1. HONESTY — the transport ack is not evidence ───────────────────────────────────────────
    await send('msg-1', 'is dit aangekomen?');
    check('a sent message never reports better than "maybe received" on the transport ack alone',
      mine.map.get('msg-1') === DELIVERY.MAYBE, String(mine.map.get('msg-1')));

    // ── 2. THE RECEIPT — a person who shares them ────────────────────────────────────────────────
    check('the message reaches the person who shares receipts', await theyStore(withBram, 'msg-1'));
    check('THE RECEIPT CROSSES — the sender learns it arrived',
      await untilTrue(() => mine.map.get('msg-1') === DELIVERY.STORED, 10000),
      String(mine.map.get('msg-1')));

    // ── 3. THE PROMISE — receipts-off must look exactly like offline ─────────────────────────────
    // Measured in ONE run, because "indistinguishable" is a claim about two states being equal, and
    // asserting either alone proves nothing.
    await send('msg-2', 'en deze?');
    check('the message reaches the person who turned receipts OFF', await theyStore(withCato, 'msg-2'));
    // Give any (wrongly) sent receipt ample time to arrive before concluding it did not.
    const quietStayed = !(await untilTrue(() => mine.map.get('msg-2') === DELIVERY.STORED, 6000));
    check('a receipts-OFF peer sends nothing back', quietStayed, String(mine.map.get('msg-2')));

    // The other silent case: the receipt-sharing peer is DARK, so nobody in the circle can confirm
    // (the third person has receipts off). Whatever this yields is what "offline" looks like.
    const darkAgain = goDark(bram);
    await send('msg-3', 'en als je weg bent?');
    const offlineState = await (async () => {
      await untilTrue(() => false, 3000);      // the same waiting the quiet case got
      return mine.map.get('msg-3');
    })();
    darkAgain();

    check('THE PROMISE HOLDS — receipts-off is INDISTINGUISHABLE from offline',
      mine.map.get('msg-2') === offlineState,
      `receipts-off: ${mine.map.get('msg-2')} · offline: ${offlineState}`);
    check('…and that shared state is the honest one, not a claim of delivery',
      offlineState === DELIVERY.MAYBE, String(offlineState));

    // ── 4. THE GATES — who may advance one of my bubbles ─────────────────────────────────────────
    // A receipt for a message this device never sent. The map's own key set is the gate: without it,
    // anyone able to reach this device could invent ids and grow the map unboundedly.
    mine.applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'never-sent-this' }, bram.pubKey);
    check('a receipt for a message I never sent is refused, not believed',
      mine.map.get('never-sent-this') === null, String(mine.map.get('never-sent-this')));

    // A receipt from someone the circle's roster does not know. This seam existed unpassed in both
    // shells until recently — any peer able to reach the device could advance one of its bubbles.
    await send('msg-4', 'wie mag dit bevestigen?');
    mine.applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'msg-4' }, 'a-stranger-on-the-relay');
    const advancedByStranger = await untilTrue(() => mine.map.get('msg-4') === DELIVERY.STORED, 3000);
    check('a receipt from someone the circle does not know is refused', !advancedByStranger,
      String(mine.map.get('msg-4')));

    // …and a real member can still confirm it, so the gate refuses strangers rather than everyone.
    check('…while a real member still can', await theyStore(withBram, 'msg-4')
      && await untilTrue(() => mine.map.get('msg-4') === DELIVERY.STORED, 10000),
      String(mine.map.get('msg-4')));
  } catch (err) {
    check('the receipts corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
