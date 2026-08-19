/**
 * The receipt RECEIVER — who is allowed to tell this device that a message arrived.
 *
 * `applyReceipt` has carried an `isRecipient` seam since 2026-07-29 and NEITHER shell passed it, so the
 * fail-closed predicate was dead code: any peer that could send this device a peer message could advance
 * one of its own bubbles to `stored`, i.e. make the app claim their device received something it did not.
 * `makeReceiptReceiver` is the wiring, and these are the two halves of what it must get right.
 *
 * The second half matters as much as the first: a check that refuses honest receipts whenever a local read
 * hiccups turns "your message may have arrived" into a permanent verdict the user cannot distinguish from
 * the truth. Refusing a spoof is worth doing; silently refusing the truth is what the delivery vocabulary
 * exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { makeReceiptReceiver } from '../../src/v2/deliverySettings.js';
import { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';
import { RECEIPT_MESSAGE } from '../../src/v2/deliveryState.js';

const receipt = (messageId) => ({ subtype: RECEIPT_MESSAGE, messageId });

/** A log holding one sent chat message in circle `c1`. */
function logWith(entries) {
  return { query: () => entries };
}

const SENT = [{ id: 'm1', ts: 1, app: 'circle', type: 'chat-message', actor: 'me', payload: { circleId: 'c1', text: 'hoi' } }];

/** A map with `m1` already marked pending, i.e. a message THIS device sent. */
function mapWithPendingM1() {
  const map = createDeliveryStateMap();
  map.set('m1', 'pending');
  return map;
}

describe('makeReceiptReceiver — only a recipient may advance a bubble', () => {
  it('accepts a receipt from a member of the message’s circle', async () => {
    const map = mapWithPendingM1();
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith(SENT),
      listCircleMembers: async () => [{ webid: 'anne', pubKey: 'KEY-ANNE', circleAddress: 'c1.anne' }],
    });
    expect(await onReceipt(receipt('m1'), 'c1.anne')).toBe(true);
    expect(map.get('m1')).toBe('stored');
  });

  it('matches ANY address the roster knows for a member, not only the one the fan-out picked', async () => {
    // The receipt comes back over whichever route the peer's device is using; accepting only the
    // per-circle address would refuse honest receipts from the same person.
    const map = mapWithPendingM1();
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith(SENT),
      listCircleMembers: async () => [{ webid: 'anne', pubKey: 'KEY-ANNE', circleAddress: 'c1.anne' }],
    });
    expect(await onReceipt(receipt('m1'), 'KEY-ANNE')).toBe(true);
    expect(map.get('m1')).toBe('stored');
  });

  it('refuses a receipt from someone who is not in the circle — the hole this closes', async () => {
    const map = mapWithPendingM1();
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith(SENT),
      listCircleMembers: async () => [{ webid: 'anne', pubKey: 'KEY-ANNE', circleAddress: 'c1.anne' }],
    });
    expect(await onReceipt(receipt('m1'), 'KEY-MALLORY')).toBe(false);
    expect(map.get('m1')).toBe('pending');
  });

  it('re-reads the roster once before refusing, so a member who joined since is not treated as an impostor', async () => {
    const map = mapWithPendingM1();
    let calls = 0;
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith(SENT),
      listCircleMembers: async () => {
        calls += 1;
        return calls === 1
          ? [{ webid: 'anne', pubKey: 'KEY-ANNE' }]
          : [{ webid: 'anne', pubKey: 'KEY-ANNE' }, { webid: 'bo', pubKey: 'KEY-BO' }];
      },
    });
    expect(await onReceipt(receipt('m1'), 'KEY-BO')).toBe(true);
    expect(calls).toBe(2);
  });

  /* ── and the half that must NOT fail closed ── */

  it('falls back to the id gate when the roster cannot be read — an honest receipt still lands', async () => {
    const map = mapWithPendingM1();
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith(SENT),
      listCircleMembers: async () => { throw new Error('offline'); },
    });
    expect(await onReceipt(receipt('m1'), 'c1.anne')).toBe(true);
    expect(map.get('m1')).toBe('stored');
  });

  it('falls back to the id gate when the message has no circle on it', async () => {
    const map = mapWithPendingM1();
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith([{ id: 'm1', ts: 1, type: 'chat-message', payload: { text: 'hoi' } }]),
      listCircleMembers: async () => [{ webid: 'anne', pubKey: 'KEY-ANNE' }],
    });
    expect(await onReceipt(receipt('m1'), 'anyone')).toBe(true);
  });

  it('still refuses an id this device never sent, roster or no roster', async () => {
    // The pre-existing gate, unchanged: the map's key set IS "messages I sent".
    const map = mapWithPendingM1();
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith(SENT),
      listCircleMembers: async () => [{ webid: 'anne', pubKey: 'KEY-ANNE', circleAddress: 'c1.anne' }],
    });
    expect(await onReceipt(receipt('never-sent'), 'c1.anne')).toBe(false);
    expect(map.get('never-sent')).toBe(null);
  });
});

describe('the delivery map announces a receipt to the view', () => {
  it('notifies subscribers when a receipt advances a message', async () => {
    // Item 4's root cause: the map advanced and nothing redrew. Both shells now subscribe; this pins the
    // notification the subscription depends on.
    const map = mapWithPendingM1();
    const seen = [];
    map.subscribe((id, state) => seen.push([id, state]));
    const onReceipt = makeReceiptReceiver({
      deliveryMap: map,
      eventLog: logWith(SENT),
      listCircleMembers: async () => [{ webid: 'anne', circleAddress: 'c1.anne' }],
    });
    await onReceipt(receipt('m1'), 'c1.anne');
    expect(seen).toEqual([['m1', 'stored']]);
  });
});
