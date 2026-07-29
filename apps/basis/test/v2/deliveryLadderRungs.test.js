/**
 * S2 · J-D1…J-D4 — the delivery ladder, after decision 1 (2026-07-29).
 *
 * The walk found seven states declared and five produced, and the two missing ones were exactly the two
 * that carried uncertainty — so the app said "sent" both for "their phone took it" and for "we never
 * heard anything back". That was J-D2, the journey the whole item exists for.
 *
 * The fix was subtraction rather than wiring, and the reason is J-D5. A phone acknowledges a message
 * whatever its owner's receipt setting says, so reporting the ack would have made a receipts-off peer
 * identifiable by where their ladder stops. The two journeys could not both be satisfied by adding rungs.
 *
 * So: `sent` and `reached-device` are gone. What is left is what the product can honestly say — it left
 * here and may have arrived, or somebody CHOSE to tell us it arrived.
 */
import { describe, it, expect } from 'vitest';
import { DELIVERY, DELIVERY_ORDER, DELIVERY_LABELS, DELIVERY_TERMINAL, deliveryAfterSend } from '../../src/v2/deliveryState.js';
import { classifyFanOut } from '@onderling/kring-host/kringBroadcast';

describe('J-D2 — the over-claim is gone', () => {
  it('a clean fan-out is `maybe-received`, not a word that reads like success', () => {
    expect(classifyFanOut({ errors: [] })).toBe(DELIVERY.MAYBE);
  });

  it('there is no state that claims arrival without someone having said so', () => {
    // `stored` is the only positive rung, and it can only come from a receipt the recipient chose to send.
    expect(DELIVERY_ORDER).toEqual([DELIVERY.PENDING, DELIVERY.MAYBE, DELIVERY.STORED]);
  });

  it('an attempt that left the device is `maybe-received` whatever the transport said', () => {
    // The ack is not evidence we may show (J-D5), so it does not change the answer. The old signature
    // took {acked, downgraded}; both are now irrelevant by decision.
    expect(deliveryAfterSend()).toBe(DELIVERY.MAYBE);
    expect(deliveryAfterSend({ acked: true })).toBe(DELIVERY.MAYBE);
    expect(deliveryAfterSend({ acked: false, downgraded: true })).toBe(DELIVERY.MAYBE);
  });

  it('failure is still distinct from doubt — a failed send does not read as "maybe"', () => {
    expect(classifyFanOut({ error: 'chat-unavailable' })).toBe(DELIVERY.FAILED);
    expect(classifyFanOut({ errors: [{ reason: 'recipient-pubkey-unknown' }] })).toBe(DELIVERY.UNDELIVERABLE);
    for (const st of DELIVERY_TERMINAL) expect(DELIVERY_ORDER).not.toContain(st);
  });
});

describe('the retired states leave nothing behind', () => {
  it('no label survives for a state that no longer exists', () => {
    expect(DELIVERY_LABELS['sent']).toBeUndefined();
    expect(DELIVERY_LABELS['reached-device']).toBeUndefined();
    // …and every state that DOES exist still has one, so nothing renders as a raw key.
    for (const st of [...DELIVERY_ORDER, ...DELIVERY_TERMINAL]) expect(DELIVERY_LABELS[st]).toBeTruthy();
  });

  it('the label for the resting state says both halves out loud', () => {
    // "Sent · maybe received" — it left, and we do not know. A label that said only "sent" is what the
    // over-claim looked like from the outside.
    expect(DELIVERY_LABELS[DELIVERY.MAYBE]).toBe('circle.chat.delivery.maybe_received');
  });
});
