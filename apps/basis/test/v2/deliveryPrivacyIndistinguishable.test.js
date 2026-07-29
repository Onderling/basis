/**
 * S2 · J-D5 — the privacy one. Walked as an EQUIVALENCE, because that is the only shape the claim has.
 *
 * The sheet states it as a sentence about what Anna sees:
 *
 *   > Anna must see the message simply stop advancing, and **nothing anywhere may tell her Bo chose
 *   > that**. It has to look exactly like an offline phone.
 *
 * "Nothing anywhere" cannot be checked by asserting one string is absent — the leak, if it exists, is in
 * the place nobody thought of as a surface. So these tests do not look for a bad string. They run the
 * SAME send twice, once against a Bo who turned receipts off and once against a Bo who is simply
 * offline, and compare the two observations whole.
 *
 * **Result, after decision 1 (2026-07-29): J-D5 holds BY CONSTRUCTION.** It used to hold by accident —
 * the ack rungs were simply unwired, and wiring them would have made a receipts-off peer identifiable by
 * where their ladder stopped. The decision removed that possibility instead of relying on it: the
 * transport ack is never reported, so there is no rung that could differ between "receipts off" and
 * "offline". Both rest at `maybe-received`.
 *
 * The distinguishing signal is therefore not merely absent, it is unrepresentable — which is the only
 * form of this promise worth having.
 */
import { describe, it, expect } from 'vitest';
import {
  DELIVERY, DELIVERY_ORDER, DELIVERY_LABELS, DELIVERY_TERMINAL,
  deliveryAfterSend, receiptPolicy, shouldSendReceipt, receiveReceipt, RECEIPT_MESSAGE,
} from '../../src/v2/deliveryState.js';
import { classifyFanOut } from '@onderling/kring-host/kringBroadcast';

/**
 * One send, observed the way Anna's client observes it: what the transport reported, plus whatever
 * arrived back from Bo. Returns EVERYTHING the sender learns — the point is that this whole object must
 * match between the two scenarios, not merely its `state` field.
 */
function observeSend({ bobPolicy, bobOnline }) {
  const messageId = 'm-1';
  // A send that left the device: `maybe-received`, whether or not Bo's phone is on. There is no branch
  // here any more, and that absence IS the property — the ack cannot enter the observation.
  let state = classifyFanOut({ errors: [] });

  // Rung 4: the app-level receipt. Bo's device only emits one when it stored the message AND his policy
  // allows it — so an offline Bo and a receipts-off Bo both send nothing.
  const bobStoredIt = bobOnline === true;
  const receiptOnWire = (bobStoredIt && shouldSendReceipt(bobPolicy))
    ? { subtype: RECEIPT_MESSAGE, messageId }
    : null;

  const applied = receiptOnWire ? receiveReceipt(receiptOnWire, 'bo') : null;
  if (applied) state = DELIVERY.STORED;

  return {
    state,
    label: DELIVERY_LABELS[state] ?? null,
    receiptSeen: applied !== null,
    // Anything else a client could render off the send result. Kept explicit so a new field has to be
    // added here consciously — which is exactly when someone should ask whether it leaks.
    terminal: DELIVERY_TERMINAL.includes(state),
  };
}

describe('J-D5 — receipts OFF is indistinguishable from OFFLINE', () => {
  it('they are identical, field for field', () => {
    const receiptsOff = observeSend({ bobPolicy: { sendReceipts: false }, bobOnline: true });
    const offline     = observeSend({ bobPolicy: { sendReceipts: true },  bobOnline: false });
    expect(receiptsOff).toEqual(offline);
    expect(receiptsOff.state).toBe(DELIVERY.MAYBE);
  });

  it('…and no ack can enter the observation, so nothing could make them differ', () => {
    // The old failure mode was a FUTURE one: wire the ack and the setting becomes readable. That future
    // is closed — `deliveryAfterSend` returns the same rung whatever the transport reported.
    expect(deliveryAfterSend({ acked: true })).toBe(deliveryAfterSend({ acked: false }));
    expect(Object.values(DELIVERY)).not.toContain('reached-device');
  });

  it('what DOES hold: neither observation carries a receipt, so nothing states the choice outright', () => {
    const receiptsOff = observeSend({ bobPolicy: { sendReceipts: false }, bobOnline: true });
    const offline     = observeSend({ bobPolicy: { sendReceipts: true },  bobOnline: false });
    expect(receiptsOff.receiptSeen).toBe(false);
    expect(offline.receiptSeen).toBe(false);
    expect(receiptsOff.terminal).toBe(false);      // neither looks like a failure
    expect(offline.terminal).toBe(false);
  });

  it('…and the state they share is one that occurs for ordinary reasons', () => {
    const { state } = observeSend({ bobPolicy: { sendReceipts: false }, bobOnline: true });
    // If receipts-off produced a state nothing else produces, the state itself would be the tell.
    expect(DELIVERY_ORDER).toContain(state);
    expect(state).not.toBe(DELIVERY.STORED);
  });

  it('a receipts-ON Bo who IS online does advance — otherwise the test above proves nothing', () => {
    const normal = observeSend({ bobPolicy: { sendReceipts: true }, bobOnline: true });
    expect(normal.state).toBe(DELIVERY.STORED);
    expect(normal.receiptSeen).toBe(true);
    // …and that outcome is genuinely different from the two indistinguishable ones.
    expect(normal).not.toEqual(observeSend({ bobPolicy: { sendReceipts: false }, bobOnline: true }));
  });
});

describe('J-D5, the other half — no state exists that only receipts-off can produce', () => {
  it('every delivery state is reachable without anyone turning receipts off', () => {
    // Reachable with receipts ON: pending (pre-send), sent/maybe (no ack), reached (ack), stored
    // (receipt). Failed/undeliverable are transport outcomes. Nothing is left over for "receipts off"
    // to own — which is the property that keeps the setting invisible.
    const withReceiptsOn = new Set([
      DELIVERY.PENDING,
      deliveryAfterSend({ acked: false }),                     // sent
      deliveryAfterSend({ acked: false, downgraded: true }),   // maybe-received
      deliveryAfterSend({ acked: true }),                      // reached-device
      DELIVERY.STORED,
      ...DELIVERY_TERMINAL,
    ]);
    const all = new Set([...DELIVERY_ORDER, ...DELIVERY_TERMINAL]);
    const onlyWithReceiptsOff = [...all].filter((s) => !withReceiptsOn.has(s));
    expect(onlyWithReceiptsOff, 'a state exists that only occurs when receipts are off — that IS the leak').toEqual([]);
  });

  it('the label set says nothing about receipts, settings or the other person’s choices', () => {
    // Not a substitute for the equivalence above — a second, cheaper net. Wording is where a leak is
    // most likely to be introduced later, by someone trying to be helpful.
    const keys = Object.values(DELIVERY_LABELS).join(' ');
    for (const word of ['receipt', 'setting', 'disabled', 'turned_off', 'unavailable', 'refused', 'opted']) {
      expect(keys, `a delivery label mentions "${word}" — that announces a choice`).not.toContain(word);
    }
  });
});

describe('J-D5 — a receipt cannot be forged on someone else’s behalf', () => {
  it('the sender comes from the wire, never from the payload', () => {
    const forged = { subtype: RECEIPT_MESSAGE, messageId: 'm-1', from: 'bo' };
    const applied = receiveReceipt(forged, 'mallory');
    // If `from` were taken from the payload, Mallory could mark Anna's messages to Bo as delivered —
    // which is a lie about Bo, told to Anna.
    expect(applied.from).toBe('mallory');
  });

  it('the default is ON, so the quiet path is the common one rather than a signal in itself', () => {
    expect(receiptPolicy({}).sendReceipts).toBe(true);
    expect(receiptPolicy(undefined).sendReceipts).toBe(true);
  });
});
