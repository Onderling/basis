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
 * **Result of the walk (2026-07-29): J-D5 holds — but for a reason worth knowing.** It holds because the
 * ladder's middle rungs are not wired. `classifyFanOut` (kringBroadcast.js) produces only
 * `failed | sent | undeliverable`; `pending` is set before the send and `stored` arrives with a receipt.
 * `reached-device` and `maybe-received` are never produced by the product at all — see
 * `deliveryLadderRungs.test.js` next door, which is the S2/J-D2 finding.
 *
 * So today both Bos look like `sent`, and Anna cannot tell them apart. The moment someone wires the
 * transport ack — which is what `reached-device` is FOR — a receipts-off Bo will settle at
 * `reached-device` while an offline Bo stays at `sent`, and the setting becomes readable from the shape
 * of the ladder. That is not hypothetical: the ack exists, it simply is not reported yet.
 *
 * Both cases are therefore pinned below: what holds now, and what will break when the rungs land.
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
function observeSend({ bobPolicy, bobOnline, ackRungsWired = false }) {
  const messageId = 'm-1';
  // What the product does TODAY: the fan-out reports success or failure, with no notion of an ack, so a
  // send that left the device reads `sent` whether or not the peer's phone is on.
  let state = ackRungsWired
    // …and what it would do once the ack is reported, which is what `deliveryAfterSend` is written for.
    ? deliveryAfterSend({ acked: bobOnline === true })
    : classifyFanOut({ errors: [] });          // 'sent'

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
  it('as the product stands, they ARE indistinguishable — both read `sent`', () => {
    const receiptsOff = observeSend({ bobPolicy: { sendReceipts: false }, bobOnline: true });
    const offline     = observeSend({ bobPolicy: { sendReceipts: true },  bobOnline: false });
    expect(receiptsOff).toEqual(offline);
    expect(receiptsOff.state).toBe(DELIVERY.SENT);
  });

  it('…but the moment the ack rungs are wired, the setting becomes readable from the ladder', () => {
    const receiptsOff = observeSend({ bobPolicy: { sendReceipts: false }, bobOnline: true, ackRungsWired: true });
    const offline     = observeSend({ bobPolicy: { sendReceipts: true },  bobOnline: false, ackRungsWired: true });

    // Walked 2026-07-29. The journey asks for these to be identical; once the acks are reported they are
    // not, and the reason is
    // structural rather than an oversight: the transport ack is not disableable ("it is how the wire
    // works", deliveryState.js), so Bo's phone acknowledges the message whatever his receipt setting
    // says. Receipts-off therefore settles at `reached-device`; a genuinely offline phone never acks at
    // all and stays at `sent`.
    //
    // No string announces anything — the label checks below all pass. The leak is the SHAPE: a message
    // that reaches the device and then never advances means "this person turned receipts off", because
    // for everyone else `reached-device` is a state you pass through on the way to `stored`.
    //
    // Recorded rather than patched: closing it is a product decision (collapse `reached-device` into
    // `sent` for everyone? hold the rung back until a receipt would have been due?), and every option
    // costs honest information that the ladder exists to give. See REMAINING-WORK.md → "? Needs Frits".
    expect(receiptsOff.state).toBe(DELIVERY.REACHED);
    expect(offline.state).toBe(DELIVERY.SENT);
    expect(receiptsOff).not.toEqual(offline);      // ← the finding, pinned so a fix flips this test
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
