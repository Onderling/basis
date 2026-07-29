/**
 * S6 · J-A5 — attacking the delivery receipt.
 *
 * Walked 2026-07-29, from the desk rather than a device: this attack needs no radio, only the ability to
 * send a peer message, which every member of a circle has.
 *
 * The house rule the receipt path is built on is that **`from` comes off the wire, never from the
 * payload** — and `receiveReceipt` honours it exactly: the sender is the wire address, and a payload that
 * names someone else is ignored. That half is sound.
 *
 * What is missing is the other half: the wire address is recorded and then **never used to decide
 * anything**. `applyReceipt` marks the message `stored` without asking whether this sender was the person
 * the message was addressed to, or whether the message exists at all.
 *
 * So a receipt is accepted from anyone, for any message id. The consequence is small in bytes and not
 * small in kind: the delivery ladder exists to stop the app claiming more than it knows, and this lets
 * someone else decide what it claims.
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

describe('J-A5 — THE ATTACK SUCCEEDS: a receipt is accepted from anyone, for anything', () => {
  it('Mallory marks Anna’s message to Bo as `stored`, though the message was never hers to receive', () => {
    // Anna sent m-1 to Bo. Mallory is in the same circle and knows the id — ids travel with the fan-out.
    const map = mapOf([['m-1', DELIVERY.SENT]]);
    const applied = applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'mallory', map);

    expect(applied).toBe(true);
    expect(map.get('m-1')).toBe(DELIVERY.STORED);
    // Anna's screen now says her message reached Bo's device and was stored there. Bo may be offline,
    // may have left the circle, may never have received it. The app is stating something it does not
    // know, on Mallory's say-so — which is the exact failure the ladder was designed to prevent.
  });

  it('…and for a message that does not exist at all, which is how the map fills with rows nobody wrote', () => {
    const map = mapOf();
    expect(applyReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'never-existed' }, 'mallory', map)).toBe(true);
    expect(map.get('never-existed')).toBe(DELIVERY.STORED);
    // Harmless on screen today — `withDelivery` only annotates rows that exist and are mine — so this is
    // unbounded attacker-controlled growth in a map rather than a visible lie. Both are worth closing.
  });

  it('the fix has everything it needs already: the true sender is right there, unused', () => {
    const receipt = receiveReceipt({ subtype: RECEIPT_MESSAGE, messageId: 'm-1' }, 'mallory');
    expect(receipt.from).toBe('mallory');
    // `applyReceipt` receives this and discards it. Checking it against the message's recipient — which
    // the sender knows, because it addressed the message — closes the attack without new plumbing.
  });
});
