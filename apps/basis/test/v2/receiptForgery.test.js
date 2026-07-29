/**
 * S6 · J-A5 — attacking the delivery receipt. **Attack found 2026-07-29, fixed the same day.**
 *
 * Walked 2026-07-29, from the desk rather than a device: this attack needs no radio, only the ability to
 * send a peer message, which every member of a circle has.
 *
 * The house rule the receipt path is built on is that **`from` comes off the wire, never from the
 * payload** — and `receiveReceipt` honours it exactly: the sender is the wire address, and a payload that
 * names someone else is ignored. That half is sound.
 *
 * What was missing was the other half: the wire address was recorded and then **never used to decide
 * anything**. `applyReceipt` marked the message `stored` without asking whether the message existed at
 * all — so a receipt was accepted from anyone, for any id, and an unknown id was created.
 *
 * The gate is now the map's own key set: every message this device sends is marked `pending` before the
 * fan-out starts, so the keys are exactly "messages I sent". Anything else is refused.
 *
 * These tests keep both halves: that the attack is closed, and — in the last block — the part that is
 * NOT closed, so nobody reads this file as saying the receipt path is fully trusted.
 */
import { describe, it, expect } from 'vitest';
import { applyReceipt } from '../../src/v2/deliverySettings.js';
import { DELIVERY, receiveReceipt, RECEIPT_MESSAGE } from '../../src/v2/deliveryState.js';

/** The delivery map the shells keep: msgId → state. */
const mapOf = (entries = []) => new Map(entries);

describe('what the receipt path gets right', () => {
  it('the sender is the WIRE address — a payload naming someone else is ignored', () => {
    const forged = { subtype: RECEIPT_MESSAGE, messageId: 'm-1', from: 'bo' };
    expect(receiveReceipt(forged, 'mallory').from).toBe('mallory');
  });

  it('a malformed receipt is refused rather than half-applied', () => {
    const map = mapOf();
    expect(applyReceipt({ subtype: 'something-else', messageId: 'm-1' }, 'bo', map)).toBe(false);
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE }, 'bo', map)).toBe(false);          // no id
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'x'.repeat(200) }, 'bo', map)).toBe(false);
    expect(map.size).toBe(0);
  });
});

describe('J-A5 — the attack, now closed', () => {
  it('a receipt for a message this device never sent is REFUSED, not believed', () => {
    // The map's keys are exactly the messages this device sent — nothing here sent 'm-1'.
    const map = mapOf();
    const applied = applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'mallory', map);
    expect(applied).toBe(false);
    expect(map.size).toBe(0);        // …and no row was created, so the map cannot be grown by a stranger
  });

  it('an id that never existed cannot be inserted — the growth hole is shut', () => {
    const map = mapOf();
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'never-existed' }, 'mallory', map)).toBe(false);
    expect(map.has('never-existed')).toBe(false);
  });

  it('an honest receipt for a message I DID send still applies — the gate is not a wall', () => {
    const map = mapOf([['m-1', DELIVERY.MAYBE]]);
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'bo', map)).toBe(true);
    expect(map.get('m-1')).toBe(DELIVERY.STORED);
  });

  it('the optional recipient check refuses a sender the host says was not a recipient', () => {
    const map = mapOf([['m-1', DELIVERY.MAYBE]]);
    const isRecipient = (from) => from === 'bo';
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'mallory', map, { isRecipient })).toBe(false);
    expect(map.get('m-1')).toBe(DELIVERY.MAYBE);          // untouched
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'bo', map, { isRecipient })).toBe(true);
  });

  it('a throwing recipient predicate refuses rather than letting the receipt through', () => {
    const map = mapOf([['m-1', DELIVERY.MAYBE]]);
    const isRecipient = () => { throw new Error('roster unavailable'); };
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'bo', map, { isRecipient })).toBe(false);
  });
});

describe('what is still OPEN — a real recipient can claim `stored` early', () => {
  it('without the host predicate, any sender is accepted for a message I did send', () => {
    // This is the residue, kept visible on purpose. Bo is genuinely in the circle; so is Mallory, and
    // she received the fan-out too — so she can send its receipt before Bo's device does.
    const map = mapOf([['m-1', DELIVERY.MAYBE]]);
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'mallory', map)).toBe(true);
    // Closing this needs the per-message recipient set, which `deliverySettings` does not hold. The seam
    // is there (`isRecipient`); wiring it is a shell job, and it is on REMAINING-WORK.
  });

  it('the true sender is available to whoever wires that seam', () => {
    expect(receiveReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'mallory').from).toBe('mallory');
  });
});
