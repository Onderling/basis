/**
 * basis v2 — the APP half of per-message delivery (labels + the receipt protocol).
 *
 * THE VOCABULARY LIVES IN THE SUBSTRATE now — `@onderling/kring-host/deliveryState` (the
 * substrate-audit's single real extraction, 2026-08-20): the ladder used to be defined here while the
 * package that keys its state map by it hardcoded a second copy, and the two had already diverged.
 * The states, their order, the terminal set and `advanceDelivery` are defined ONCE there (with the
 * full design story — the retired `sent`/`reached-device` rungs, the retry exception, the
 * no-receipts-off-state privacy rule) and re-exported here so every existing import keeps working.
 * The duplicate-vocab guard registers the substrate home, so a re-grown copy fails CI.
 *
 * What REMAINS here is what only the app can own:
 *   • `DELIVERY_LABELS` — state → locale key (wording is a shell concern, `circle.chat.delivery.*`);
 *   • `deliveryAfterSend` — the app's honesty rule for what a send attempt may claim;
 *   • the receipt PROTOCOL — the per-user setting (`receiptPolicy`/`shouldSendReceipt`), the wire
 *     subtype (`RECEIPT_MESSAGE`) and the inbound validator (`receiveReceipt`).
 */

import { DELIVERY } from '@onderling/kring-host/deliveryState';

export {
  DELIVERY, DELIVERY_TERMINAL, DELIVERY_ORDER,
  deliveryStates, isDeliveryState, advanceDelivery,
} from '@onderling/kring-host/deliveryState';

/** Every state → its locale key. Shared, so web and mobile cannot word the same fact differently. */
export const DELIVERY_LABELS = Object.freeze({
  [DELIVERY.PENDING]:       'circle.chat.delivery.pending',
  [DELIVERY.FAILED]:        'circle.chat.delivery.failed',
  [DELIVERY.UNDELIVERABLE]: 'circle.chat.delivery.undeliverable',
  [DELIVERY.MAYBE]:         'circle.chat.delivery.maybe_received',
  [DELIVERY.STORED]:        'circle.chat.delivery.stored',
});

/**
 * What the state becomes after an attempt to send.
 *
 * Always the same answer, and that is the decision rather than a simplification.
 *
 * The transport ack is not evidence we may show: a device acknowledges a message whatever its owner's
 * receipt setting says, so reporting it would make a receipts-off peer identifiable by where their
 * ladder stops (S2/J-D5). And a send with no confirmation is not a success, which is what the retired
 * `sent` state implied (S2/J-D2). So an attempt that left this device is `maybe-received` — it may well
 * have arrived, and we do not know.
 *
 * Positive evidence exists, but only one kind: a receipt the recipient CHOSE to send (`stored`).
 */
export function deliveryAfterSend() {
  return DELIVERY.MAYBE;
}

/**
 * The per-user receipt setting.
 *
 * Governs only the APP-level receipt (the ladder's strongest rung). The transport ack cannot be
 * disabled without disabling delivery itself — it is how the wire works — so this is the only rung
 * there is a choice about.
 *
 * Default ON: it is useful, and the privacy cost is small next to the message content the peer already
 * has. Turning it off is a real choice, and the model is built so that choosing it does not announce
 * itself.
 */
export function receiptPolicy(stored = {}) {
  return Object.freeze({ sendReceipts: stored?.sendReceipts !== false });
}

/**
 * Should I send an app-level receipt for a message I just stored?
 *
 * Deliberately takes the whole policy rather than a boolean, so a call site cannot accidentally pass
 * something truthy and enable a disclosure the user turned off.
 */
export function shouldSendReceipt(policy) {
  return receiptPolicy(policy).sendReceipts === true;
}

/**
 * The wire subtype an app-level receipt travels as.
 *
 * `subtype`, kebab-case — the HOUSE wire convention: the peer router (`makePeerRouter`) dispatches on
 * `payload.subtype`, as every existing peer message does (`circle-chat-message`, `catch-up-offer`, …).
 * The first draft said `kind: 'delivery.receipt'`, which no router would ever have dispatched.
 */
export const RECEIPT_MESSAGE = 'delivery-receipt';

/**
 * Validate an inbound receipt. Same discipline as the room messages: rebuilt not spread, and `from` comes
 * from the wire — a receipt claiming to be from someone else would let a peer mark another person's
 * messages as delivered.
 */
export function receiveReceipt(payload, fromAddress, now = () => Date.now()) {
  if (payload?.subtype !== RECEIPT_MESSAGE) return null;
  const id = typeof payload.messageId === 'string' && payload.messageId.length > 0
    && payload.messageId.length <= 128 ? payload.messageId : null;
  if (!id) return null;
  return Object.freeze({ messageId: id, from: fromAddress ?? null, receivedAt: now() });
}
