/**
 * How far a message actually got (G8/G9/G10).
 *
 * Two properties carry this, and both are about NOT saying more than is true:
 *
 *   • the ladder only goes up, because acks and receipts arrive out of order;
 *   • **no state means "they turned receipts off"** — a state that said so would broadcast the setting to
 *     everyone who messages you, which is the opposite of what a privacy setting is for.
 */
// Vocabulary note (decision 1, 2026-07-29): `sent` and `reached-device` are retired — `sent` read as
// success while meaning only "the fan-out accepted it" (S2/J-D2), and `reached-device` is the transport
// ack, never shown because a phone acks whatever its owner's receipt setting says (S2/J-D5). The resting
// state for an unconfirmed message is `maybe-received`; `stored` is the only positive rung, and it can
// only come from a receipt the recipient CHOSE to send.

import { describe, it, expect } from 'vitest';
import * as mod from '../../src/v2/deliveryState.js';
import {
  DELIVERY, DELIVERY_ORDER, DELIVERY_TERMINAL, DELIVERY_LABELS, deliveryStates, isDeliveryState,
  advanceDelivery, deliveryAfterSend, receiptPolicy, shouldSendReceipt,
  receiveReceipt, RECEIPT_MESSAGE,
} from '../../src/v2/deliveryState.js';

describe('the ladder', () => {
  it('is ONE ladder, and every rung is something the product can actually say', () => {
    // Three rungs after decision 1: it has not left yet, it left and we do not know, someone told us it
    // arrived. `sent` and `reached-device` were removed rather than wired — see the note above.
    expect(DELIVERY_ORDER).toEqual(['pending', 'maybe-received', 'stored']);
    // Still no read-receipt vocabulary: `stored` is about a device, never about a person having looked.
    expect(DELIVERY_ORDER.some((s) => /read|seen|viewed/i.test(s))).toBe(false);
  });

  it('every label lives in the EXISTING namespace, so the wording has one home', () => {
    for (const key of Object.values(DELIVERY_LABELS)) {
      expect(key).toMatch(/^circle\.chat\.delivery\./);
    }
  });

  it('the terminal states are where a message STOPPED, not rungs', () => {
    expect(DELIVERY_TERMINAL).toEqual(['failed', 'undeliverable']);
    expect(DELIVERY_ORDER).not.toContain('failed');
  });

  it('every state has a label, and they are shared', () => {
    for (const s of deliveryStates()) {
      expect(DELIVERY_LABELS[s], `no label for ${s}`).toMatch(/^circle\./);
    }
    expect(Object.isFrozen(DELIVERY_LABELS)).toBe(true);
  });

  it('THE PRIVACY RULE: nothing in the model says "receipts are off for this person"', () => {
    // The tempting addition — "delivery updates unavailable for them" — looks like helpfulness and is a
    // disclosure: it announces a setting to everyone who messages you. Absence must stay ambiguous.
    const leaky = /off|disabled|unavailable|refused|opted|blocked/i;
    expect(deliveryStates().filter((s) => leaky.test(s))).toEqual([]);
    expect(Object.keys(DELIVERY).filter((k) => leaky.test(k))).toEqual([]);
    // …and no exported helper that answers the question either.
    expect(Object.keys(mod).filter((k) => /receiptsOffFor|hasReceiptsDisabled|canReceipt/i.test(k))).toEqual([]);
  });
});

describe('the ladder only goes up', () => {
  it('advances forward', () => {
    expect(advanceDelivery(DELIVERY.MAYBE, DELIVERY.MAYBE)).toBe(DELIVERY.MAYBE);
    expect(advanceDelivery(DELIVERY.MAYBE, DELIVERY.STORED)).toBe(DELIVERY.STORED);
  });

  it('NEVER demotes — a late transport-ack must not undo an app receipt', () => {
    // Out-of-order arrival is normal, not exceptional: the receipt travels the same unreliable network.
    expect(advanceDelivery(DELIVERY.STORED, DELIVERY.MAYBE)).toBe(DELIVERY.STORED);
    expect(advanceDelivery(DELIVERY.MAYBE, DELIVERY.MAYBE)).toBe(DELIVERY.MAYBE);
    expect(advanceDelivery(DELIVERY.MAYBE, DELIVERY.MAYBE)).toBe(DELIVERY.MAYBE);
  });

  it('is idempotent, and survives junk on either side', () => {
    expect(advanceDelivery(DELIVERY.MAYBE, DELIVERY.MAYBE)).toBe(DELIVERY.MAYBE);
    expect(advanceDelivery(DELIVERY.MAYBE, 'nonsense')).toBe(DELIVERY.MAYBE);
    expect(advanceDelivery('nonsense', DELIVERY.MAYBE)).toBe(DELIVERY.MAYBE);
    expect(advanceDelivery(undefined, undefined)).toBe(DELIVERY.PENDING);
  });

  it('rejects unknown states', () => {
    expect(isDeliveryState('read')).toBe(false);
    expect(isDeliveryState(DELIVERY.STORED)).toBe(true);
  });
});

describe('what a send produces', () => {
  it('an acknowledged send is STILL only `maybe-received` — the ack is not evidence we show', () => {
    expect(deliveryAfterSend({ acked: true })).toBe(DELIVERY.MAYBE);
  });

  it('THE DOWNGRADE CASE: asked, heard nothing, sent anyway ⇒ MAYBE received', () => {
    // `sendMessage` falls back to fire-and-forget when the ack times out. "Sent" would read as success and
    // "failed" would be wrong — it may well have arrived and the ack may have been lost.
    expect(deliveryAfterSend({ acked: false, downgraded: true })).toBe(DELIVERY.MAYBE);
  });

  it('an ordinary unconfirmed send is `maybe-received`', () => {
    expect(deliveryAfterSend({})).toBe(DELIVERY.MAYBE);
    expect(deliveryAfterSend({ acked: false, downgraded: false })).toBe(DELIVERY.MAYBE);
  });
});

describe('the receipt setting', () => {
  it('defaults ON, and only an explicit false turns it off', () => {
    expect(receiptPolicy().sendReceipts).toBe(true);
    expect(receiptPolicy({}).sendReceipts).toBe(true);
    expect(receiptPolicy({ sendReceipts: false }).sendReceipts).toBe(false);
  });

  it('takes the whole policy, so a stray truthy value cannot enable a disclosure', () => {
    // `shouldSendReceipt(true)` must not mean "yes" — that is how a call site accidentally re-enables
    // something the user switched off.
    expect(shouldSendReceipt({ sendReceipts: false })).toBe(false);
    expect(shouldSendReceipt({ sendReceipts: true })).toBe(true);
    expect(shouldSendReceipt('yes')).toBe(true);   // a non-object is "not configured" ⇒ the default
  });

  it('governs only the APP receipt — the transport ack is how the wire works', () => {
    // There is no knob for rung 3, deliberately: disabling it would mean disabling delivery.
    expect(Object.keys(mod).filter((k) => /disableAck|suppressAck/i.test(k))).toEqual([]);
  });
});

describe('an inbound receipt is untrusted', () => {
  it('takes `from` from the WIRE', () => {
    // Otherwise a peer marks someone else's messages as delivered.
    const r = receiveReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm1', from: 'someone-else' }, 'real');
    expect(r.from).toBe('real');
  });

  it('is rebuilt — nothing smuggled survives', () => {
    const r = receiveReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm1', state: 'read', admin: true }, 'them');
    expect(Object.keys(r).sort()).toEqual(['from', 'messageId', 'receivedAt']);
    // In particular a peer cannot assert a state — least of all one we do not have.
    expect(r.state).toBeUndefined();
  });

  it('rejects a malformed or wrong-kind message', () => {
    expect(receiveReceipt({ subtype: RECEIPT_MESSAGE }, 'them')).toBeNull();
    expect(receiveReceipt({ subtype: RECEIPT_MESSAGE, messageId: '' }, 'them')).toBeNull();
    expect(receiveReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'x'.repeat(200) }, 'them')).toBeNull();
    expect(receiveReceipt({ subtype: 'kring-chat-message', messageId: 'm1' }, 'them')).toBeNull();
    expect(receiveReceipt(null, 'them')).toBeNull();
  });
});

describe('terminal states', () => {
  it('a failure REPLACES whatever the ladder had reached', () => {
    expect(advanceDelivery(DELIVERY.MAYBE, DELIVERY.FAILED)).toBe(DELIVERY.FAILED);
    expect(advanceDelivery(DELIVERY.PENDING, DELIVERY.UNDELIVERABLE)).toBe(DELIVERY.UNDELIVERABLE);
  });

  it('a RETRY is allowed out of a terminal state — it is an act, not an arrival', () => {
    // The shipped flow is `pending → failed → (retry) pending → sent`, pinned by a kring-host test since
    // δ.2. Making terminals fully absorbing broke it.
    expect(advanceDelivery(DELIVERY.FAILED, DELIVERY.PENDING)).toBe(DELIVERY.PENDING);
    expect(advanceDelivery(DELIVERY.UNDELIVERABLE, DELIVERY.PENDING)).toBe(DELIVERY.PENDING);
  });

  it('and nothing else resurrects it — a stale ack must not un-fail a message', () => {
    // The user was told it did not go. A late confirmation arriving afterwards is not a reason to quietly
    // change that story.
    expect(advanceDelivery(DELIVERY.FAILED, DELIVERY.MAYBE)).toBe(DELIVERY.FAILED);
    expect(advanceDelivery(DELIVERY.UNDELIVERABLE, DELIVERY.STORED)).toBe(DELIVERY.UNDELIVERABLE);
  });

  it('they are still valid states, so a renderer can label them', () => {
    expect(isDeliveryState(DELIVERY.FAILED)).toBe(true);
    expect(DELIVERY_LABELS[DELIVERY.FAILED]).toBe('circle.chat.delivery.failed');
  });
});

