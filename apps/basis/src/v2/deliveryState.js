/**
 * basis v2 — how far a message actually got (G8/G9/G10, decided 2026-07-28).
 *
 * Today "sent" means *handed to our own transport*. That is the weakest possible claim and it reads like the
 * strongest — a checkmark that means "we tried". This is the ladder that replaces it, and every rung is
 * named for what it actually proves rather than for how it feels.
 *
 *   sent            we handed it to our transport. Nobody has confirmed anything.
 *   maybe-received  we asked for confirmation, got none, and sent it anyway. It MAY have arrived and the
 *                   confirmation may have been lost — genuinely unknown. (Frits' word, and the right one:
 *                   "sent" over-claims here and "failed" under-claims.)
 *   reached-device  their TRANSPORT acknowledged it. Note what this does not mean: the ack is sent before
 *                   their app sees the envelope, so this is "their phone has the bytes", not "their app
 *                   kept them".
 *   stored          their APP accepted and stored it. The strongest claim we make.
 *
 * There is deliberately no read receipt. Frits: *"reading confirmation is not important now."*
 *
 * ── This EXTENDS the existing vocabulary; it does not replace it ─────────────────────────────────────────
 * The chat bubble already had delivery states — `pending` (fan-out in flight), `sent`, `failed`,
 * `undeliverable` — with their own locale keys under `circle.chat.delivery.*`. Writing this I nearly added
 * a second, parallel set, which is exactly the drift this repo keeps having to undo.
 *
 * They compose into ONE ladder rather than competing, because they describe different halves of the same
 * journey:
 *
 *   pending ──▶ sent ──▶ maybe-received ──▶ reached-device ──▶ stored
 *      │
 *      ├─▶ failed          (the send itself did not go; retryable)
 *      └─▶ undeliverable   (no address to send to at all)
 *
 * So the old states are the *near* end and the new ones the *far* end, `sent` is the hinge, and everything
 * lives under `circle.chat.delivery.*`. One vocabulary, one place to change the wording.
 *
 * ── Two rules that are easy to get wrong ─────────────────────────────────────────────────────────────────
 *
 * **1. The ladder only goes up.** Acks and receipts arrive out of order, and a late transport-ack after an
 * app-receipt must not demote "stored" back to "reached". `advanceDelivery` enforces that, which is why the
 * states are an ordered list rather than a set of flags.
 *
 * **2. There is NO state meaning "they turned receipts off."** Receipts are disableable for privacy, and a
 * state that said so would defeat the point — it would broadcast the setting to everyone who messages you.
 * Absence has to stay ambiguous: a receipt that never comes might be an offline phone, a closed app, a full
 * disk, or a choice, and nothing in this model distinguishes them. `deliveryStates()` is asserted against
 * that in the tests, because the tempting addition ("delivery updates unavailable for this person") looks
 * like helpfulness and is a disclosure.
 */

export const DELIVERY = Object.freeze({
  // The near end — the local send attempt. These already existed.
  PENDING: 'pending',
  FAILED: 'failed',
  UNDELIVERABLE: 'undeliverable',
  // The hinge, and the far end.
  //
  // Decision 1 (2026-07-29) retired two states that used to sit here:
  //
  //   `sent`           — it read as success and meant only "the fan-out accepted it". Every message that
  //                      left the device stopped here, so the app said the same thing for "their phone
  //                      took it" and "we never heard anything back". That was the over-claim (S2/J-D2).
  //   `reached-device` — the transport ack. Deliberately never reported: a phone acks whatever its owner's
  //                      receipt setting says, so surfacing it would let anyone identify a peer who turned
  //                      receipts off, by watching where the ladder stops (S2/J-D5).
  //
  // What remains is what we can honestly say: it left here and may have arrived (`maybe-received`), or
  // someone CHOSE to tell us it arrived (`stored`).
  MAYBE: 'maybe-received',
  STORED: 'stored',
});

/** The terminal negatives. Not on the ladder: they are where a message stopped, not how far it got. */
export const DELIVERY_TERMINAL = Object.freeze([DELIVERY.FAILED, DELIVERY.UNDELIVERABLE]);

/** Ordered weakest → strongest. The order IS the semantics; see rule 1. */
export const DELIVERY_ORDER = Object.freeze([
  DELIVERY.PENDING, DELIVERY.MAYBE, DELIVERY.STORED,
]);

/** Every state → its locale key. Shared, so web and mobile cannot word the same fact differently. */
export const DELIVERY_LABELS = Object.freeze({
  [DELIVERY.PENDING]:       'circle.chat.delivery.pending',
  [DELIVERY.FAILED]:        'circle.chat.delivery.failed',
  [DELIVERY.UNDELIVERABLE]: 'circle.chat.delivery.undeliverable',
  [DELIVERY.MAYBE]:         'circle.chat.delivery.maybe_received',
  [DELIVERY.STORED]:        'circle.chat.delivery.stored',
});

/** The states that exist. Exported so a test can assert nothing was added that leaks a setting. */
export function deliveryStates() { return [...DELIVERY_ORDER]; }

export function isDeliveryState(v) {
  return DELIVERY_ORDER.includes(v) || DELIVERY_TERMINAL.includes(v);
}

/**
 * Move a message's state forward, never back.
 *
 * Out-of-order arrival is normal, not exceptional: the app receipt travels the same unreliable network as
 * the transport ack and can overtake it. Taking the max is the only rule that survives that.
 */
export function advanceDelivery(current, next) {
  // A terminal state is where a message STOPPED, so it is not compared on the ladder: it replaces whatever
  // came before, and a stale ack must not resurrect a message the user was told did not go.
  //
  // ONE exception, and it comes from the shipped flow rather than from theory: `pending → failed → (retry)
  // pending → sent`. A retry is an ACT, not an arrival, so `pending` is allowed out of a terminal state and
  // nothing else is.
  if (DELIVERY_TERMINAL.includes(current)) return next === DELIVERY.PENDING ? next : current;
  if (DELIVERY_TERMINAL.includes(next)) return next;

  const a = DELIVERY_ORDER.indexOf(current);
  const b = DELIVERY_ORDER.indexOf(next);
  if (b < 0) return isDeliveryState(current) ? current : DELIVERY.PENDING;
  if (a < 0) return next;
  return b > a ? next : current;
}

/**
 * What the state becomes after an attempt to send.
 *
 * @param {object} outcome
 * @param {boolean} outcome.acked        the transport ack came back
 * @param {boolean} [outcome.downgraded] we asked for an ack, timed out, and sent fire-and-forget anyway
 */
export function deliveryAfterSend() {
  // Always the same answer, and that is the decision rather than a simplification.
  //
  // The transport ack is not evidence we may show: a device acknowledges a message whatever its owner's
  // receipt setting says, so reporting it would make a receipts-off peer identifiable by where their
  // ladder stops (S2/J-D5). And a send with no confirmation is not a success, which is what the retired
  // `sent` state implied (S2/J-D2). So an attempt that left this device is `maybe-received` — it may well
  // have arrived, and we do not know.
  //
  // Positive evidence exists, but only one kind: a receipt the recipient CHOSE to send (`stored`).
  return DELIVERY.MAYBE;
}

/**
 * The per-user receipt setting.
 *
 * Governs only the APP-level receipt (rung 4). The transport ack cannot be disabled without disabling
 * delivery itself — it is how the wire works — so this is the only rung there is a choice about.
 *
 * Default ON: it is useful, and the privacy cost is small next to the message content the peer already has.
 * Turning it off is a real choice, and the model above is built so that choosing it does not announce
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
