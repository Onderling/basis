/**
 * How far a message actually got (G8/G9/G10).
 *
 * Two properties carry this, and both are about NOT saying more than is true:
 *
 *   • the ladder only goes up, because acks and receipts arrive out of order;
 *   • **no state means "they turned receipts off"** — a state that said so would broadcast the setting to
 *     everyone who messages you, which is the opposite of what a privacy setting is for.
 */
import { describe, it, expect } from 'vitest';
import * as mod from '../../src/v2/deliveryState.js';
import {
  DELIVERY, DELIVERY_ORDER, DELIVERY_LABELS, deliveryStates, isDeliveryState,
  advanceDelivery, deliveryAfterSend, receiptPolicy, shouldSendReceipt,
  receiveReceipt, RECEIPT_MESSAGE,
} from '../../src/v2/deliveryState.js';

describe('the ladder', () => {
  it('names four states, weakest to strongest, and no read receipt', () => {
    expect(DELIVERY_ORDER).toEqual(['sent', 'maybe-received', 'reached-device', 'stored']);
    expect(DELIVERY_ORDER.some((s) => /read|seen|viewed/i.test(s))).toBe(false);
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
    expect(advanceDelivery(DELIVERY.SENT, DELIVERY.REACHED)).toBe(DELIVERY.REACHED);
    expect(advanceDelivery(DELIVERY.REACHED, DELIVERY.STORED)).toBe(DELIVERY.STORED);
  });

  it('NEVER demotes — a late transport-ack must not undo an app receipt', () => {
    // Out-of-order arrival is normal, not exceptional: the receipt travels the same unreliable network.
    expect(advanceDelivery(DELIVERY.STORED, DELIVERY.REACHED)).toBe(DELIVERY.STORED);
    expect(advanceDelivery(DELIVERY.REACHED, DELIVERY.MAYBE)).toBe(DELIVERY.REACHED);
    expect(advanceDelivery(DELIVERY.MAYBE, DELIVERY.SENT)).toBe(DELIVERY.MAYBE);
  });

  it('is idempotent, and survives junk on either side', () => {
    expect(advanceDelivery(DELIVERY.REACHED, DELIVERY.REACHED)).toBe(DELIVERY.REACHED);
    expect(advanceDelivery(DELIVERY.REACHED, 'nonsense')).toBe(DELIVERY.REACHED);
    expect(advanceDelivery('nonsense', DELIVERY.SENT)).toBe(DELIVERY.SENT);
    expect(advanceDelivery(undefined, undefined)).toBe(DELIVERY.SENT);
  });

  it('rejects unknown states', () => {
    expect(isDeliveryState('read')).toBe(false);
    expect(isDeliveryState(DELIVERY.STORED)).toBe(true);
  });
});

describe('what a send produces', () => {
  it('an acknowledged send reached the device', () => {
    expect(deliveryAfterSend({ acked: true })).toBe(DELIVERY.REACHED);
  });

  it('THE DOWNGRADE CASE: asked, heard nothing, sent anyway ⇒ MAYBE received', () => {
    // `sendMessage` falls back to fire-and-forget when the ack times out. "Sent" would read as success and
    // "failed" would be wrong — it may well have arrived and the ack may have been lost.
    expect(deliveryAfterSend({ acked: false, downgraded: true })).toBe(DELIVERY.MAYBE);
  });

  it('an ordinary unconfirmed send is just sent', () => {
    expect(deliveryAfterSend({})).toBe(DELIVERY.SENT);
    expect(deliveryAfterSend({ acked: false, downgraded: false })).toBe(DELIVERY.SENT);
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
    const r = receiveReceipt({ kind: RECEIPT_MESSAGE, messageId: 'm1', from: 'someone-else' }, 'real');
    expect(r.from).toBe('real');
  });

  it('is rebuilt — nothing smuggled survives', () => {
    const r = receiveReceipt({ kind: RECEIPT_MESSAGE, messageId: 'm1', state: 'read', admin: true }, 'them');
    expect(Object.keys(r).sort()).toEqual(['from', 'messageId', 'receivedAt']);
    // In particular a peer cannot assert a state — least of all one we do not have.
    expect(r.state).toBeUndefined();
  });

  it('rejects a malformed or wrong-kind message', () => {
    expect(receiveReceipt({ kind: RECEIPT_MESSAGE }, 'them')).toBeNull();
    expect(receiveReceipt({ kind: RECEIPT_MESSAGE, messageId: '' }, 'them')).toBeNull();
    expect(receiveReceipt({ kind: RECEIPT_MESSAGE, messageId: 'x'.repeat(200) }, 'them')).toBeNull();
    expect(receiveReceipt({ kind: 'chat-message', messageId: 'm1' }, 'them')).toBeNull();
    expect(receiveReceipt(null, 'them')).toBeNull();
  });
});
