/**
 * S2 · J-D1…J-D4 — which rungs of the delivery ladder the product can actually reach.
 *
 * The ladder declares seven states and labels all seven. The send path produces five of them:
 *
 *   pending      — set before the fan-out starts
 *   sent         — `classifyFanOut` with no errors
 *   failed       — an error, or a transient per-member failure
 *   undeliverable— every per-member failure is permanent
 *   stored       — an inbound app-level receipt
 *
 * The two it never produces are exactly the two that carry uncertainty:
 *
 *   maybe-received — "we asked for an ack, heard nothing, sent it anyway"
 *   reached-device — "the peer's transport confirmed"
 *
 * **This is the S2/J-D2 finding (walked 2026-07-29).** The sheet calls J-D2 "the one this whole item
 * exists for": with the receiver's acks failing, a message must read *maybe received*, not *sent* —
 * "if it reads 'sent', the over-claim is back." It reads `sent`, because `classifyFanOut` has no notion
 * of an ack at all. `deliveryAfterSend` — the function that computes those two rungs — is called from
 * nowhere but tests, and `sendMessage`'s `onDelivery` report, which is where the ack/downgrade
 * distinction is actually made, is wired in tests only.
 *
 * So the honesty the ladder was built to provide is, at the far end, not yet delivered: today the app
 * says "sent" for both "the phone took it" and "we never heard anything back". That is the over-claim
 * the vocabulary exists to prevent.
 *
 * These tests pin the gap rather than assert the intent — they should FAIL when the rungs get wired,
 * which is the moment to delete them and walk J-D2 for real.
 */
import { describe, it, expect } from 'vitest';
import { DELIVERY, DELIVERY_ORDER, DELIVERY_LABELS, deliveryAfterSend } from '../../src/v2/deliveryState.js';
import { classifyFanOut } from '@onderling/kring-host/kringBroadcast';

/** Every state the real send path can put on a message today. */
const PRODUCED = new Set([
  DELIVERY.PENDING,                       // marked before the call
  classifyFanOut({ errors: [] }),         // sent
  classifyFanOut({ error: 'chat-unavailable' }),                        // failed
  classifyFanOut({ errors: [{ reason: 'not-a-member' }] }),             // failed or undeliverable
  DELIVERY.STORED,                        // an inbound receipt
]);

describe('what the fan-out can actually report', () => {
  it('a clean fan-out is `sent` — never `reached-device`, because no ack is consulted', () => {
    expect(classifyFanOut({ errors: [] })).toBe(DELIVERY.SENT);
  });

  it('an error is `failed`; all-permanent errors are `undeliverable`', () => {
    expect(classifyFanOut({ error: 'chat-unavailable' })).toBe(DELIVERY.FAILED);
    expect(classifyFanOut({ errors: [{ reason: 'whatever-transient' }] })).toBe(DELIVERY.FAILED);
  });

  it('THE FINDING — `maybe-received` is unreachable, so J-D2 cannot pass', () => {
    // Nothing the fan-out can return produces it…
    const everyShape = [
      { errors: [] }, { error: 'x' }, { errors: [{ reason: 'a' }] }, {}, null, undefined,
    ].map((r) => classifyFanOut(r));
    expect(everyShape).not.toContain(DELIVERY.MAYBE);
    // …and the function that WOULD produce it is called from nowhere but tests.
    expect(deliveryAfterSend({ acked: false, downgraded: true })).toBe(DELIVERY.MAYBE);
  });

  it('`reached-device` is unreachable too — the middle of the ladder is missing, not just the top', () => {
    expect(PRODUCED.has(DELIVERY.REACHED)).toBe(false);
    expect(deliveryAfterSend({ acked: true })).toBe(DELIVERY.REACHED);   // the code exists, unused
  });

  it('the two unreachable rungs are exactly the ones that express uncertainty', () => {
    const unreachable = [...DELIVERY_ORDER].filter((s) => !PRODUCED.has(s));
    expect(unreachable.sort()).toEqual([DELIVERY.MAYBE, DELIVERY.REACHED].sort());
  });

  it('…and both are fully labelled, which is why the gap is invisible from the UI side', () => {
    // A state with no label would have been noticed. These have labels in both locales and a place in
    // the order — everything except a producer.
    expect(DELIVERY_LABELS[DELIVERY.MAYBE]).toBeTruthy();
    expect(DELIVERY_LABELS[DELIVERY.REACHED]).toBeTruthy();
  });
});
